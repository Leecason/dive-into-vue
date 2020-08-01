import applyMixin from './mixin'
import devtoolPlugin from './plugins/devtool'
import ModuleCollection from './module/module-collection'
import { forEachValue, isObject, isPromise, assert, partial } from './util'

let Vue // bind on install

export class Store {
  constructor (options = {}) {
    // Auto install if it is not done yet and `window` has `Vue`.
    // To allow users to avoid auto-installation in some cases,
    // this code should be placed here. See #731

    // 在浏览器环境下，允许通过外链的方式去使用 Vue 和 Vuex，，在实例 Store 之前自动安装 Vuex
    if (!Vue && typeof window !== 'undefined' && window.Vue) {
      install(window.Vue)
    }

    if (__DEV__) {
      // 实例 Store 前必须先安装 Vuex
      assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`)
      // 依赖 Promise
      assert(typeof Promise !== 'undefined', `vuex requires a Promise polyfill in this browser.`)
      // Store 只能作为构造函数被使用
      assert(this instanceof Store, `store must be called with the new operator.`)
    }

    const {
       // 应用在 store 上的插件，每个插件接收 store 作为唯一参数，可以监听 mutations（用于外部地数据持久化、记录或调试）或者提交 mutation（用于内部数据，例如 websocket 或 某些观察者）
      plugins = [],
       // 严格模式，在严格模式下，任何 mutation 处理函数以外修改 Vuex state 都会抛出错误
      strict = false
    } = options

    // store internal state
    this._committing = false
    this._actions = Object.create(null) // 存放 actions
    this._actionSubscribers = [] // actions 订阅者
    this._mutations = Object.create(null) // 存放 mutations
    this._wrappedGetters = Object.create(null) // 存放 getters
    this._modules = new ModuleCollection(options) // module 收集器
    this._modulesNamespaceMap = Object.create(null)
    this._subscribers = [] // 订阅者
    this._watcherVM = new Vue()
    this._makeLocalGettersCache = Object.create(null) // namespaced module 对应 getters 代理的缓存

    // bind commit and dispatch to self
    const store = this
    const { dispatch, commit } = this
    // 修改 dispatch 和 commit 的执行上下文为 store 本身，否则在组件内部使用 this.dispatch 时会指向 vue 实例
    this.dispatch = function boundDispatch (type, payload) {
      return dispatch.call(store, type, payload)
    }
    this.commit = function boundCommit (type, payload, options) {
      return commit.call(store, type, payload, options)
    }

    // strict mode
    // 严格模式，在严格模式下，任何 mutation 处理函数以外修改 Vuex state 都会抛出错误
    this.strict = strict

    const state = this._modules.root.state

    // init root module.
    // this also recursively registers all sub-modules
    // and collects all module getters inside this._wrappedGetters

    // 初始化根 module，过程中同时递归注册所有子 module
    // 收集所有 module 的 getter 到 _wrappedGetters
    installModule(this, state, [], this._modules.root /* 根 module 才独有的 module 对象 */)

    // initialize the store vm, which is responsible for the reactivity
    // (also registers _wrappedGetters as computed properties)

    // 设置 store._vm，实例一个 Vue 对象来使 state 以及 getters 变为响应式 */
    resetStoreVM(this, state)

    // apply plugins
    // 调用插件
    plugins.forEach(plugin => plugin(this))

    // devtool 插件
    const useDevtools = options.devtools !== undefined ? options.devtools : Vue.config.devtools
    if (useDevtools) {
      devtoolPlugin(this)
    }
  }

  // store.state 实际上是 _vm.data.$$state
  get state () {
    return this._vm._data.$$state
  }

  set state (v) {
    if (__DEV__) {
      assert(false, `use store.replaceState() to explicit replace store state.`)
    }
  }

  commit (_type, _payload, _options) {
    // check object-style commit
    const {
      type,
      payload,
      options
    } = unifyObjectStyle(_type, _payload, _options)

    const mutation = { type, payload }
    const entry = this._mutations[type]
    if (!entry) {
      if (__DEV__) {
        console.error(`[vuex] unknown mutation type: ${type}`)
      }
      return
    }
    this._withCommit(() => {
      entry.forEach(function commitIterator (handler) {
        handler(payload)
      })
    })

    this._subscribers
      .slice() // shallow copy to prevent iterator invalidation if subscriber synchronously calls unsubscribe
      .forEach(sub => sub(mutation, this.state))

    if (
      __DEV__ &&
      options && options.silent
    ) {
      console.warn(
        `[vuex] mutation type: ${type}. Silent option has been removed. ` +
        'Use the filter functionality in the vue-devtools'
      )
    }
  }

  dispatch (_type, _payload) {
    // check object-style dispatch
    const {
      type,
      payload
    } = unifyObjectStyle(_type, _payload)

    const action = { type, payload }
    const entry = this._actions[type]
    if (!entry) {
      if (__DEV__) {
        console.error(`[vuex] unknown action type: ${type}`)
      }
      return
    }

    try {
      this._actionSubscribers
        .slice() // shallow copy to prevent iterator invalidation if subscriber synchronously calls unsubscribe
        .filter(sub => sub.before)
        .forEach(sub => sub.before(action, this.state))
    } catch (e) {
      if (__DEV__) {
        console.warn(`[vuex] error in before action subscribers: `)
        console.error(e)
      }
    }

    const result = entry.length > 1
      ? Promise.all(entry.map(handler => handler(payload)))
      : entry[0](payload)

    return new Promise((resolve, reject) => {
      result.then(res => {
        try {
          this._actionSubscribers
            .filter(sub => sub.after)
            .forEach(sub => sub.after(action, this.state))
        } catch (e) {
          if (__DEV__) {
            console.warn(`[vuex] error in after action subscribers: `)
            console.error(e)
          }
        }
        resolve(res)
      }, error => {
        try {
          this._actionSubscribers
            .filter(sub => sub.error)
            .forEach(sub => sub.error(action, this.state, error))
        } catch (e) {
          if (__DEV__) {
            console.warn(`[vuex] error in error action subscribers: `)
            console.error(e)
          }
        }
        reject(error)
      })
    })
  }

  subscribe (fn, options) {
    return genericSubscribe(fn, this._subscribers, options)
  }

  subscribeAction (fn, options) {
    const subs = typeof fn === 'function' ? { before: fn } : fn
    return genericSubscribe(subs, this._actionSubscribers, options)
  }

  watch (getter, cb, options) {
    if (__DEV__) {
      assert(typeof getter === 'function', `store.watch only accepts a function.`)
    }
    return this._watcherVM.$watch(() => getter(this.state, this.getters), cb, options)
  }

  replaceState (state) {
    this._withCommit(() => {
      this._vm._data.$$state = state
    })
  }

  registerModule (path, rawModule, options = {}) {
    if (typeof path === 'string') path = [path]

    if (__DEV__) {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
      assert(path.length > 0, 'cannot register the root module by using registerModule.')
    }

    this._modules.register(path, rawModule)
    installModule(this, this.state, path, this._modules.get(path), options.preserveState)
    // reset store to update getters...
    resetStoreVM(this, this.state)
  }

  unregisterModule (path) {
    if (typeof path === 'string') path = [path]

    if (__DEV__) {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
    }

    this._modules.unregister(path)
    this._withCommit(() => {
      const parentState = getNestedState(this.state, path.slice(0, -1))
      Vue.delete(parentState, path[path.length - 1])
    })
    resetStore(this)
  }

  hasModule (path) {
    if (typeof path === 'string') path = [path]

    if (__DEV__) {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
    }

    return this._modules.isRegistered(path)
  }

  hotUpdate (newOptions) {
    this._modules.update(newOptions)
    resetStore(this, true)
  }

  // 保证在执行 fn 时，_committing 为 true
  // 应该确保 state 的修改只能通过 mutation，在严格模式开启的情况下，外部对 state 的直接修改将会抛出错误
  _withCommit (fn) {
    const committing = this._committing
    this._committing = true
    fn()
    this._committing = committing
  }
}

function genericSubscribe (fn, subs, options) {
  if (subs.indexOf(fn) < 0) {
    options && options.prepend
      ? subs.unshift(fn)
      : subs.push(fn)
  }
  return () => {
    const i = subs.indexOf(fn)
    if (i > -1) {
      subs.splice(i, 1)
    }
  }
}

function resetStore (store, hot) {
  store._actions = Object.create(null)
  store._mutations = Object.create(null)
  store._wrappedGetters = Object.create(null)
  store._modulesNamespaceMap = Object.create(null)
  const state = store.state
  // init all modules
  installModule(store, state, [], store._modules.root, true)
  // reset vm
  resetStoreVM(store, state, hot)
}

// 初始化 store._vm
function resetStoreVM (store, state, hot) {
  const oldVm = store._vm // 存放之前的 vm

  // bind store public getters
  store.getters = {}
  // reset local getters cache
  store._makeLocalGettersCache = Object.create(null)
  const wrappedGetters = store._wrappedGetters
  const computed = {}

  // 通过 Object.defineProperty 为每一个 getter 方法设置 get 方法
  // 比如获取 this.$store.getters.test 的时候获取的是 store._vm.test，也就是 Vue 对象的 computed 属性
  forEachValue(wrappedGetters, (fn, key) => {
    // use computed to leverage its lazy-caching mechanism
    // direct inline function use will lead to closure preserving oldVm.
    // using partial to return function with only arguments preserved in closure environment.
    computed[key] = partial(fn, store)
    Object.defineProperty(store.getters, key, {
      get: () => store._vm[key],
      enumerable: true // for local getters
    })
  })

  // use a Vue instance to store the state tree
  // suppress warnings just in case the user has added
  // some funky global mixins
  const silent = Vue.config.silent
  // 将 Vue.config.silent 暂时设置为 true，目的是在 new Vue 过程中不会报出一切警告
  Vue.config.silent = true
  // 实例一个 Vue 对象，使 state 以及 getters 变为响应式 */
  store._vm = new Vue({
    data: {
      $$state: state // 将 state 设为 vm 的 data
    },
    computed
  })
  Vue.config.silent = silent

  // enable strict mode for new vm
  // 启用了严格模式，确保修改 store 只能通过 mutation
  if (store.strict) {
    enableStrictMode(store)
  }

  // 销毁旧 vm
  if (oldVm) {
    // 解除旧 vm 对 state 的引用，以及销毁旧 vm 对象
    if (hot) {
      // dispatch changes in all subscribed watchers
      // to force getter re-evaluation for hot reloading.
      store._withCommit(() => {
        oldVm._data.$$state = null
      })
    }
    Vue.nextTick(() => oldVm.$destroy())
  }
}

// 安装 module
function installModule (store, rootState, path, module, hot) {
  const isRoot = !path.length // 根 module
  const namespace = store._modules.getNamespace(path) // 获取 module 的 namespace

  // register in namespace map

  // 如果有 namespace 则在 _modulesNamespaceMap 中注册
  if (module.namespaced) {
    if (store._modulesNamespaceMap[namespace] && __DEV__) {
      console.error(`[vuex] duplicate namespace ${namespace} for the namespaced module ${path.join('/')}`)
    }
    store._modulesNamespaceMap[namespace] = module
  }

  // set state
  // 将子 module 的 state 设置到父 state 上，并使其为响应式
  if (!isRoot && !hot) {
    const parentState = getNestedState(rootState, path.slice(0, -1)) // 获取父级 state
    const moduleName = path[path.length - 1] // module 名称
    store._withCommit(() => {
      if (__DEV__) {
        if (moduleName in parentState) {
          console.warn(
            `[vuex] state field "${moduleName}" was overridden by a module with the same name at "${path.join('.')}"`
          )
        }
      }
      // 将子 module 的 state 设置为响应式
      Vue.set(parentState, moduleName, module.state)
    })
  }

  // 构造 module 本地上下文环境
  const local = module.context = makeLocalContext(store, namespace, path)

  // 遍历注册 module 的 mutation
  module.forEachMutation((mutation, key) => {
    const namespacedType = namespace + key // 拼接 type
    registerMutation(store, namespacedType, mutation, local)
  })

  // 遍历注册 module 的 action
  module.forEachAction((action, key) => {
    const type = action.root ? key : namespace + key // 拼接 type
    const handler = action.handler || action // action 支持对象形式
    registerAction(store, type, handler, local)
  })

  // 遍历注册 module 的 getter
  module.forEachGetter((getter, key) => {
    const namespacedType = namespace + key // 拼接 type
    registerGetter(store, namespacedType, getter, local)
  })

  // 递归安装 module
  module.forEachChild((child, key) => {
    installModule(store, rootState, path.concat(key) /* 拼接 path */, child, hot)
  })
}

/**
 * make localized dispatch, commit, getters and state
 * if there is no namespace, just use root ones
 *
 * 构造 module 的 dispatch，commit，getters 和 state 本地上下文环境
 * 如果没有 namespace 配置，则使用全局上下文环境
 */
function makeLocalContext (store, namespace, path) {
  const noNamespace = namespace === '' // 是否有命名空间

  const local = {
    // 对于 dispatch，如果没有命名空间，则使用全局的 dispatch 方法
    // 否则会创建一个方法，把 type 拼接上 namespace，然后执行 store 上对应的方法
    dispatch: noNamespace ? store.dispatch : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      if (!options || !options.root) {
        type = namespace + type // type 拼接 namespace
        if (__DEV__ && !store._actions[type]) {
          console.error(`[vuex] unknown local action type: ${args.type}, global type: ${type}`)
          return
        }
      }

      return store.dispatch(type, payload)
    },

    // 对于 commit，如果没有命名空间，则使用全局的 commit 方法
    // 否则会创建一个方法，把 type 拼接上 namespace，然后执行 store 上对应的方法
    commit: noNamespace ? store.commit : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      if (!options || !options.root) {
        type = namespace + type // type 拼接 namespace
        if (__DEV__ && !store._mutations[type]) {
          console.error(`[vuex] unknown local mutation type: ${args.type}, global type: ${type}`)
          return
        }
      }

      store.commit(type, payload, options)
    }
  }

  // getters and state object must be gotten lazily
  // because they will be changed by vm update
  Object.defineProperties(local, {
    getters: {
      // 没有 namespace，直接返回 root store 的 getters，否则构造本地上下文环境的 getters
      get: noNamespace
        ? () => store.getters
        : () => makeLocalGetters(store, namespace)
    },
    state: {
      get: () => getNestedState(store.state, path)
    }
  })

  return local
}

// 构造本地上下文环境 getters
function makeLocalGetters (store, namespace) {
  if (!store._makeLocalGettersCache[namespace]) {
    const gettersProxy = {} // getters 代理
    const splitPos = namespace.length
    Object.keys(store.getters).forEach(type => {
      // skip if the target getter is not match this namespace

       // 根据 namespace 去查找对应的 module 的 getters，不满足则跳过此次遍历
      if (type.slice(0, splitPos) !== namespace) return

      // extract local getter type
      const localType = type.slice(splitPos) // 获取 getter 的 type

      // Add a port to the getters proxy.
      // Define as getter property because
      // we do not want to evaluate the getters in this time.
      Object.defineProperty(gettersProxy, localType, {
        get: () => store.getters[type], // 返回 namespace 下对应 type 的 getter
        enumerable: true
      })
    })
    store._makeLocalGettersCache[namespace] = gettersProxy // 缓存 namespace 对应的 getters 代理
  }

  return store._makeLocalGettersCache[namespace]
}

// 注册 mutation
function registerMutation (store, type, handler, local) {
  // 所有的 mutation 将会被添加到 store._mutations 对象中，同一 type 的 _mutations 可以对应多个方法
  const entry = store._mutations[type] || (store._mutations[type] = [])
  entry.push(function wrappedMutationHandler (payload) {
    handler.call(store /* mutation 执行上下文，为 root store */, local.state /* module 对应的 state */, payload)
  })
}

// 注册 action
function registerAction (store, type, handler, local) {
  // 所有的 action 将会被添加到 store._actions 对象中，同一 type 的 _actions 可以对应多个方法
  const entry = store._actions[type] || (store._actions[type] = [])
  entry.push(function wrappedActionHandler (payload) {
    let res = handler.call(store /* action 执行上下文，为 root store */, {
      dispatch: local.dispatch, // module 对应的 dispatch
      commit: local.commit, // module 对应的 commit
      getters: local.getters, // module 对应的 getters
      state: local.state, // module 对应的 state
      rootGetters: store.getters, // 根 getters
      rootState: store.state // 根 state
    }, payload)
    if (!isPromise(res)) {
      res = Promise.resolve(res)
    }
    if (store._devtoolHook) {
      return res.catch(err => {
        store._devtoolHook.emit('vuex:error', err)
        throw err
      })
    } else {
      return res
    }
  })
}

// 注册 getter
function registerGetter (store, type, rawGetter, local) {
  if (store._wrappedGetters[type]) {
    if (__DEV__) {
      console.error(`[vuex] duplicate getter key: ${type}`)
    }
    return
  }
  store._wrappedGetters[type] = function wrappedGetter (store) {
    return rawGetter(
      local.state, // module 对应的 state
      local.getters, // module 对应的 getters
      store.state, // 根 state
      store.getters // 根 getters
    )
  }
}

// 启用严格模式，确保 state 的修改只能通过 mutation
function enableStrictMode (store) {
  store._vm.$watch(function () { return this._data.$$state }, () => {
    if (__DEV__) {
      assert(store._committing, `do not mutate vuex store state outside mutation handlers.`)
    }
  }, { deep: true, sync: true }) // 使用了 deep 选项，会有一定性能开销，通常只在开发环境开启严格模式
}

// 获取 module 下的 state
function getNestedState (state, path) {
  return path.reduce((state, key) => state[key], state)
}

function unifyObjectStyle (type, payload, options) {
  if (isObject(type) && type.type) {
    options = payload
    payload = type
    type = type.type
  }

  if (__DEV__) {
    assert(typeof type === 'string', `expects string as the type, but found ${typeof type}.`)
  }

  return { type, payload, options }
}

// 安装 Vuex 插件的方法
export function install (_Vue) {
  // 防止重复安装
  if (Vue && _Vue === Vue) {
    if (__DEV__) {
      console.error(
        '[vuex] already installed. Vue.use(Vuex) should be called only once.'
      )
    }
    return
  }
  Vue = _Vue // 缓存 Vue
  applyMixin(Vue) // 向全局混入 beforeCreate 钩子，在钩子中将注入的 Vuex.Store 实例绑定到 vue 实例上
}
