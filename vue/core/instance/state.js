/* @flow */

import config from '../config'
import Watcher from '../observer/watcher'
import Dep, { pushTarget, popTarget } from '../observer/dep'
import { isUpdatingChildComponent } from './lifecycle'

import {
  set,
  del,
  observe,
  defineReactive,
  toggleObserving
} from '../observer/index'

import {
  warn,
  bind,
  noop,
  hasOwn,
  hyphenate,
  isReserved,
  handleError,
  nativeWatch,
  validateProp,
  isPlainObject,
  isServerRendering,
  isReservedAttribute
} from '../util/index'

const sharedPropertyDefinition = {
  enumerable: true,
  configurable: true,
  get: noop,
  set: noop
}

// 代理，把对 target[sourceKey][key] 的读写 -> 对 vm[key] 的读写
// 例如：「props」，把对 vm._props.xxx 的读写 -> 对 vm.xxx 的读写，所以 vm.xxx 可以访问到 props 中属性
export function proxy (target: Object, sourceKey: string, key: string) {
  sharedPropertyDefinition.get = function proxyGetter () {
    return this[sourceKey][key]
  }
  sharedPropertyDefinition.set = function proxySetter (val) {
    this[sourceKey][key] = val
  }
  Object.defineProperty(target, key, sharedPropertyDefinition)
}

export function initState (vm: Component) {
  vm._watchers = []
  const opts = vm.$options
  if (opts.props) initProps(vm, opts.props) // 初始化 props
  if (opts.methods) initMethods(vm, opts.methods) // 初始化 methods
  if (opts.data) { // 初始化 data
    initData(vm)
  } else {
    observe(vm._data = {}, true /* asRootData */)
  }
  if (opts.computed) initComputed(vm, opts.computed) // 初始化 computed
  // 初始化 watch
  // Firefox 的 Object 原型上有一个 watch 方法，这里叫 nativeWatch，定义在 src/core/util/env.js
  if (opts.watch && opts.watch !== nativeWatch) {
    initWatch(vm, opts.watch)
  }
}

// 初始化 props
function initProps (vm: Component, propsOptions: Object /* 已经被规范的 props */) {
  const propsData = vm.$options.propsData || {} // 父元素传递过来的 props 数据
  const props = vm._props = {} // 在 vm._props 中存储 props
  // cache prop keys so that future props updates can iterate using Array
  // instead of dynamic object key enumeration.
  const keys = vm.$options._propKeys = [] // 缓存的实例所有 props 的键
  const isRoot = !vm.$parent // 是否是根 vue 实例
  // root instance props should be converted
  if (!isRoot) { // 不是根实例
    // 接下来要将 props 变为响应式，但是对于引用类型 prop
    // 执行 toggleObserving(false) 将不再递归调用 observe
    // 因为子组件的 prop 值始终指向父组件的 prop 值，所以父组件 prop 值变化会触发子组件的更新
    // 所以对于引用类型 prop 的递归 observe 过程可以省略
    toggleObserving(false)
  }
  // 遍历 props
  for (const key in propsOptions) {
    keys.push(key)
    // 校验 props
    const value = validateProp(key, propsOptions, propsData, vm)
    /* istanbul ignore else */
    if (process.env.NODE_ENV !== 'production') { // 校验 prop 是否为 html 保留属性
      const hyphenatedKey = hyphenate(key)
      if (isReservedAttribute(hyphenatedKey) ||
          config.isReservedAttr(hyphenatedKey)) {
        warn(
          `"${hyphenatedKey}" is a reserved attribute and cannot be used as component prop.`,
          vm
        )
      }
      // 开发环境会对 prop 有一段自定义的 setter，直接对 prop 赋值时会抛出警告
      defineReactive(props, key, value, () => {
        if (!isRoot && !isUpdatingChildComponent) {
          warn(
            `Avoid mutating a prop directly since the value will be ` +
            `overwritten whenever the parent component re-renders. ` +
            `Instead, use a data or computed property based on the prop's ` +
            `value. Prop being mutated: "${key}"`,
            vm
          )
        }
      })
    } else {
      // 把每个 props 变成响应式
      defineReactive(props, key, value)
    }
    // static props are already proxied on the component's prototype
    // during Vue.extend(). We only need to proxy props defined at
    // instantiation here.

    // 代理 props
    // 将 vm._props.xxx 的属性代理到 vue 实例上，使得通过 vm.xxx 可以访问到 props
    // 对非根实例的子组件而言，代理发生在 Vue.extend，src/core/global-api/extend.js
    if (!(key in vm)) {
      proxy(vm, `_props`, key)
    }
  }
  toggleObserving(true)
}

// 初始化 data
function initData (vm: Component) {
  let data = vm.$options.data // 获取组件对象上定义的 data
  // 在 vm._data 中存储 data
  data = vm._data = typeof data === 'function' // 如果 data 是个工厂函数，则将它的返回值作为 data
    ? getData(data, vm)
    : data || {}
  if (!isPlainObject(data)) {
    data = {}
    process.env.NODE_ENV !== 'production' && warn(
      'data functions should return an object:\n' +
      'https://vuejs.org/v2/guide/components.html#data-Must-Be-a-Function',
      vm
    )
  }
  // proxy data on instance
  const keys = Object.keys(data)
  // 校验 data 中的属性是否在 props 或者 methods 上有同名的定义
  const props = vm.$options.props
  const methods = vm.$options.methods
  let i = keys.length
  while (i--) {
    const key = keys[i]
    if (process.env.NODE_ENV !== 'production') {
      if (methods && hasOwn(methods, key)) {
        warn(
          `Method "${key}" has already been defined as a data property.`,
          vm
        )
      }
    }
    if (props && hasOwn(props, key)) {
      process.env.NODE_ENV !== 'production' && warn(
        `The data property "${key}" is already declared as a prop. ` +
        `Use prop default value instead.`,
        vm
      )
    } else if (!isReserved(key)) { // 将 vm._data.xxx 的属性代理到 vue 实例上，使得通过 vm.xxx 可以访问到 data
      proxy(vm, `_data`, key)
    }
  }
  // observe data
  // 将 data 变为响应式
  observe(data, true /* asRootData */)
}

export function getData (data: Function, vm: Component): any {
  // #7573 disable dep collection when invoking data getters
  pushTarget()
  try {
    return data.call(vm, vm)
  } catch (e) {
    handleError(e, vm, `data()`)
    return {}
  } finally {
    popTarget()
  }
}

// 实例计算属性的 watcher 时传入，表示这是一个 computed watcher
const computedWatcherOptions = { lazy: true }

// 初始化 computed
function initComputed (vm: Component, computed: Object) {
  // $flow-disable-line
  // 存储 computed watcher 的对象
  const watchers = vm._computedWatchers = Object.create(null)
  // computed properties are just getters during SSR
  const isSSR = isServerRendering()

  // 遍历 computed 属性
  for (const key in computed) {
    const userDef = computed[key] // 拿到定义的 computed
    // 计算属性可能是一个 function，也有可能是设置了 get 以及 set 的对象
    const getter = typeof userDef === 'function' ? userDef : userDef.get
    if (process.env.NODE_ENV !== 'production' && getter == null) {
      // getter 不存在的时候抛出警告并且给 getter 赋空函数
      warn(
        `Getter is missing for computed property "${key}".`,
        vm
      )
    }

    if (!isSSR) {
      // create internal watcher for the computed property.

      // 为计算属性创建一个 watcher 实例，并传入参数 { lazy: true }，会使得 watcher 的 dirty 为 true
      watchers[key] = new Watcher(
        vm,
        getter || noop,
        noop,
        computedWatcherOptions // { lazy: true }
      )
    }

    // component-defined computed properties are already defined on the
    // component prototype. We only need to define computed properties defined
    // at instantiation here.
    // 组件正在定义的计算属性如果已经定义在现有组件上则不会进行重复定义
    if (!(key in vm)) {
      defineComputed(vm, key, userDef) // 定义计算属性
    } else if (process.env.NODE_ENV !== 'production') {
      // 如果计算属性与已经定义的 data/props 发生命名冲突则抛出警告
      if (key in vm.$data) {
        warn(`The computed property "${key}" is already defined in data.`, vm)
      } else if (vm.$options.props && key in vm.$options.props) {
        warn(`The computed property "${key}" is already defined as a prop.`, vm)
      }
    }
  }
}

// 定义计算属性
export function defineComputed (
  target: any, // vue 实例
  key: string, // 计算属性的名称
  userDef: Object | Function // 计算属性的定义
) {
  const shouldCache = !isServerRendering()
  if (typeof userDef === 'function') { // 计算属性是一个函数（通常情况）
    // 创建计算属性的 getter
    sharedPropertyDefinition.get = shouldCache
      ? createComputedGetter(key)
      : createGetterInvoker(userDef)
    // 当计算属性的定义是一个 function 时是不需要 setter 的，所以这边给它设置成了空函数
    // 因为计算属性默认是一个function，只设置getter
    // 当需要设置setter的时候，会将计算属性设置成一个对象
    sharedPropertyDefinition.set = noop
  } else { // 计算属性是一个对象，{ get: ..., set: ... }
    // get 不存在则直接给空函数，如果存在则查看是否有缓存 cache，没有依旧赋值 get，有的话使用 createComputedGetter 创建
    sharedPropertyDefinition.get = userDef.get
      ? shouldCache && userDef.cache !== false
        ? createComputedGetter(key)
        : createGetterInvoker(userDef.get)
      : noop
    // 如果有设置 set 方法则直接使用，否则赋值空函数
    sharedPropertyDefinition.set = userDef.set || noop
  }
  // 开发环境下，如果计算属性没有 set 则会赋值一个默认方法：给计算属性赋值时会发出警告
  if (process.env.NODE_ENV !== 'production' &&
      sharedPropertyDefinition.set === noop) {
    sharedPropertyDefinition.set = function () {
      warn(
        `Computed property "${key}" was assigned to but it has no setter.`,
        this
      )
    }
  }
  // 使用 defineProperty 给上 getter 和 setter
  Object.defineProperty(target, key, sharedPropertyDefinition)
}

// 创建计算属性的 getter
function createComputedGetter (key) {
  // 当这个 getter 触发时，也就是计算属性被求值时，进入到此方法
  return function computedGetter () {
    // 拿到这个计算属性对应的 watcher
    const watcher = this._computedWatchers && this._computedWatchers[key]
    if (watcher) {
      // 实际是脏检查，在计算属性中的依赖发生改变的时候 dirty 会变成 true，在 get 的时候重新计算计算属性的输出值
      if (watcher.dirty) {
        watcher.evaluate()
      }
      // 收集该计算属性的依赖
      if (Dep.target) {
        watcher.depend()
      }
      return watcher.value // 返回计算属性的值
    }
  }
}

function createGetterInvoker(fn) {
  return function computedGetter () {
    return fn.call(this, this)
  }
}

function initMethods (vm: Component, methods: Object) {
  const props = vm.$options.props
  for (const key in methods) {
    if (process.env.NODE_ENV !== 'production') {
      if (typeof methods[key] !== 'function') {
        warn(
          `Method "${key}" has type "${typeof methods[key]}" in the component definition. ` +
          `Did you reference the function correctly?`,
          vm
        )
      }
      if (props && hasOwn(props, key)) {
        warn(
          `Method "${key}" has already been defined as a prop.`,
          vm
        )
      }
      if ((key in vm) && isReserved(key)) {
        warn(
          `Method "${key}" conflicts with an existing Vue instance method. ` +
          `Avoid defining component methods that start with _ or $.`
        )
      }
    }
    vm[key] = typeof methods[key] !== 'function' ? noop : bind(methods[key], vm)
  }
}

// 初始化 watch
function initWatch (vm: Component, watch: Object) {
  // 遍历 watch
  for (const key in watch) {
    const handler = watch[key]
    // 支持同一个 key 有多个 watch handler
    if (Array.isArray(handler)) {
      for (let i = 0; i < handler.length; i++) {
        createWatcher(vm, key, handler[i])
      }
    } else {
      createWatcher(vm, key, handler)
    }
  }
}

// 创建观察者 watcher
function createWatcher (
  vm: Component, // vue 实例
  expOrFn: string | Function, // 被侦听的表达式
  handler: any, // watch 回调
  options?: Object // watch 选项
) {
  // 如果 handler 是纯对象
  // watch: {
  //   test: {
  //     handler: function () {},
  //     deep: true
  //    }
  //  }
  if (isPlainObject(handler)) {
    options = handler
    handler = handler.handler
  }
  if (typeof handler === 'string') { // 也可以直接使用 methods 中的方法
    handler = vm[handler]
  }
  // 否则 handler 为函数
  // 使用 $watch 来创建一个 watcher 来观察该对象的变化
  return vm.$watch(expOrFn, handler, options)
}

export function stateMixin (Vue: Class<Component>) {
  // flow somehow has problems with directly declared definition object
  // when using Object.defineProperty, so we have to procedurally build up
  // the object here.
  const dataDef = {}
  dataDef.get = function () { return this._data }
  const propsDef = {}
  propsDef.get = function () { return this._props }
  if (process.env.NODE_ENV !== 'production') {
    dataDef.set = function () {
      warn(
        'Avoid replacing instance root $data. ' +
        'Use nested data properties instead.',
        this
      )
    }
    propsDef.set = function () {
      warn(`$props is readonly.`, this)
    }
  }
  Object.defineProperty(Vue.prototype, '$data', dataDef)
  Object.defineProperty(Vue.prototype, '$props', propsDef)

  Vue.prototype.$set = set
  Vue.prototype.$delete = del

  // $watch方法，用来为对象建立观察者监听变化
  Vue.prototype.$watch = function (
    expOrFn: string | Function,
    cb: any,
    options?: Object
  ): Function {
    const vm: Component = this
    // 判断 cb 如果为纯对象，则调用 createWatcher，因为 $watch 可能被外部直接调用
    if (isPlainObject(cb)) {
      return createWatcher(vm, expOrFn, cb, options)
    }
    options = options || {} // watcher 选项
    options.user = true // 表示用户自定义的观察者
    const watcher = new Watcher(vm, expOrFn, cb, options) // 实例 watcher
    // 有 immediate 参数会直接执行
    if (options.immediate) {
      try {
        cb.call(vm, watcher.value)
      } catch (error) {
        handleError(error, vm, `callback for immediate watcher "${watcher.expression}"`)
      }
    }
    // 返回一个 unwatch 的函数来取消观察，用来停止触发回调
    return function unwatchFn () {
      watcher.teardown() // 将自身从所有依赖收集订阅列表删除
    }
  }
}
