import { isObject } from './util'

/**
 * Reduce the code which written in Vue.js for getting the state.
 * @param {String} [namespace] - Module's namespace
 * @param {Object|Array} states # Object's item can be a function which accept state and getters for param, you can do something for state and getters in it.
 * @param {Object}
 */

 // mapState 语法糖
export const mapState = normalizeNamespace((namespace, states) => {
  const res = {} // 返回值是个对象
  if (__DEV__ && !isValidMap(states)) {
    console.error('[vuex] mapState: mapper parameter must be either an Array or an Object')
  }
  normalizeMap(states).forEach(({ key /* 外部在使用时的 key */, val /* 从 store.state 上取值时的 key */}) => {
    res[key] = function mappedState () {
      let state = this.$store.state // 根 state
      let getters = this.$store.getters // 根 getters
      // 处理 namespace
      if (namespace) {
        const module = getModuleByNamespace(this.$store, 'mapState', namespace) // 获取 namespace 对应的 module
        if (!module) {
          return
        }
        state = module.context.state // module 对应的 state
        getters = module.context.getters // module 对应的 getters
      }

      /*
        如果val是一个函数，则返回函数的调用，否则从state里找出这个 val 对应的属性
        举个例子：
          mapState({
            test,
            test2: state => {
              return state.a + state.b
            }
          })
          最终得到
          {
            test () {
              return this.$store.state.test;
            },
            test2 (state, getters) {
              return state.a + state.b;
            }
          }
      */
      return typeof val === 'function'
        ? val.call(this, state, getters)
        : state[val]
    }
    // mark vuex getter for devtools
    res[key].vuex = true
  })
  return res
})

/**
 * Reduce the code which written in Vue.js for committing the mutation
 * @param {String} [namespace] - Module's namespace
 * @param {Object|Array} mutations # Object's item can be a function which accept `commit` function as the first param, it can accept anthor params. You can commit mutation and do any other things in this function. specially, You need to pass anthor params from the mapped function.
 * @return {Object}
 */

// mapMutations 语法糖
export const mapMutations = normalizeNamespace((namespace, mutations) => {
  const res = {} // 返回值是个对象
  if (__DEV__ && !isValidMap(mutations)) {
    console.error('[vuex] mapMutations: mapper parameter must be either an Array or an Object')
  }
  normalizeMap(mutations).forEach(({ key, val }) => {
    res[key] = function mappedMutation (...args) {
      // Get the commit method from store
      let commit = this.$store.commit // store 的 commit API
      // 处理 namespace
      if (namespace) {
        const module = getModuleByNamespace(this.$store, 'mapMutations', namespace) // 获取 namespace 对应的 module
        if (!module) {
          return
        }
        commit = module.context.commit // module 对应的 commit
      }
      return typeof val === 'function'
        ? val.apply(this, [commit].concat(args))
        : commit.apply(this.$store, [val].concat(args))
    }
  })
  return res
})

/**
 * Reduce the code which written in Vue.js for getting the getters
 * @param {String} [namespace] - Module's namespace
 * @param {Object|Array} getters
 * @return {Object}
 */

// mapGetters 语法糖
export const mapGetters = normalizeNamespace((namespace, getters) => {
  const res = {} // 返回值是个对象
  if (__DEV__ && !isValidMap(getters)) {
    console.error('[vuex] mapGetters: mapper parameter must be either an Array or an Object')
  }
  normalizeMap(getters).forEach(({ key, val }) => {
    // The namespace has been mutated by normalizeNamespace
    val = namespace + val // 拼接 namespace
    res[key] = function mappedGetter () {
      if (namespace && !getModuleByNamespace(this.$store, 'mapGetters', namespace)) {
        return
      }
      if (__DEV__ && !(val in this.$store.getters)) {
        console.error(`[vuex] unknown getter: ${val}`)
        return
      }
      return this.$store.getters[val] // 返回 namespace 对应 module 的 getter
    }
    // mark vuex getter for devtools
    res[key].vuex = true
  })
  return res
})

/**
 * Reduce the code which written in Vue.js for dispatch the action
 * @param {String} [namespace] - Module's namespace
 * @param {Object|Array} actions # Object's item can be a function which accept `dispatch` function as the first param, it can accept anthor params. You can dispatch action and do any other things in this function. specially, You need to pass anthor params from the mapped function.
 * @return {Object}
 */

// mapActions 语法糖
export const mapActions = normalizeNamespace((namespace, actions) => {
  const res = {} // 返回值是个对象
  if (__DEV__ && !isValidMap(actions)) {
    console.error('[vuex] mapActions: mapper parameter must be either an Array or an Object')
  }
  normalizeMap(actions).forEach(({ key, val }) => {
    res[key] = function mappedAction (...args) {
      // get dispatch function from store
      let dispatch = this.$store.dispatch // store 的 dispatch API
      if (namespace) {
        const module = getModuleByNamespace(this.$store, 'mapActions', namespace) // 获取 namespace 对应的 module
        if (!module) {
          return
        }
        dispatch = module.context.dispatch // module 对应的 dispatch
      }
      return typeof val === 'function'
        ? val.apply(this, [dispatch].concat(args))
        : dispatch.apply(this.$store, [val].concat(args))
    }
  })
  return res
})

/**
 * Rebinding namespace param for mapXXX function in special scoped, and return them by simple object
 * @param {String} namespace
 * @return {Object}
 */
export const createNamespacedHelpers = (namespace) => ({
  mapState: mapState.bind(null, namespace),
  mapGetters: mapGetters.bind(null, namespace),
  mapMutations: mapMutations.bind(null, namespace),
  mapActions: mapActions.bind(null, namespace)
})

/**
 * Normalize the map
 * normalizeMap([1, 2, 3]) => [ { key: 1, val: 1 }, { key: 2, val: 2 }, { key: 3, val: 3 } ]
 * normalizeMap({a: 1, b: 2, c: 3}) => [ { key: 'a', val: 1 }, { key: 'b', val: 2 }, { key: 'c', val: 3 } ]
 * @param {Array|Object} map
 * @return {Object}
 */

// 将 map 转化成 [{key, val}, {key, val}, {key, val}...] 的数据结构
function normalizeMap (map) {
  if (!isValidMap(map)) {
    return []
  }
  return Array.isArray(map)
    ? map.map(key => ({ key, val: key }))
    : Object.keys(map).map(key => ({ key, val: map[key] }))
}

/**
 * Validate whether given map is valid or not
 * @param {*} map
 * @return {Boolean}
 */
function isValidMap (map) {
  return Array.isArray(map) || isObject(map)
}

/**
 * Return a function expect two param contains namespace and map. it will normalize the namespace and then the param's function will handle the new namespace and the map.
 * @param {Function} fn
 * @return {Function}
 */

// 规范化 namespace
function normalizeNamespace (fn) {
  return (namespace, map) => {
     // 兼容 namespace 不传的情况，如 mapState(['a', 'b'])
    if (typeof namespace !== 'string') {
      map = namespace
      namespace = ''
    // 保证 namespace 最后一位是 `/`
    } else if (namespace.charAt(namespace.length - 1) !== '/') {
      namespace += '/'
    }
    return fn(namespace, map)
  }
}

/**
 * Search a special module from store by namespace. if module not exist, print error message.
 * @param {Object} store
 * @param {String} helper
 * @param {String} namespace
 * @return {Object}
 */

// 根据 namespace 获取对应的 module
function getModuleByNamespace (store, helper, namespace) {
  const module = store._modulesNamespaceMap[namespace]
  if (__DEV__ && !module) {
    console.error(`[vuex] module namespace not found in ${helper}(): ${namespace}`)
  }
  return module
}
