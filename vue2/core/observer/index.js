/* @flow */

import Dep from './dep'
import VNode from '../vdom/vnode'
import { arrayMethods } from './array'
import {
  def,
  warn,
  hasOwn,
  hasProto,
  isObject,
  isPlainObject,
  isPrimitive,
  isUndef,
  isValidArrayIndex,
  isServerRendering
} from '../util/index'

const arrayKeys = Object.getOwnPropertyNames(arrayMethods)

/**
 * In some cases we may want to disable observation inside a component's
 * update computation.
 *
 * 用来控制是否需要 observe
 */
export let shouldObserve: boolean = true

export function toggleObserving (value: boolean) {
  shouldObserve = value
}

/**
 * Observer class that is attached to each observed
 * object. Once attached, the observer converts the target
 * object's property keys into getter/setters that
 * collect dependencies and dispatch updates.
 *
 * 用于给对象属性添加 getter 和 setter
 * getter：依赖收集
 * setter：派发更新
 * 使用方式：new Observer
 */
export class Observer {
  value: any;
  dep: Dep;
  vmCount: number; // number of vms that have this object as root $data

  constructor (value: any) {
    this.value = value
    this.dep = new Dep() // 存储订阅该 value 的订阅者（watcher）
    this.vmCount = 0
    def(value, '__ob__', this) // 使得通过 value.__ob__ 可以访问到该 observer 实例
    if (Array.isArray(value)) {
      // 如果是数组，将修改数组后可以截获响应的数组方法替换掉该数组的原型中的原生方法，达到监听数组数据变化响应的效果
      if (hasProto) { // 当前浏览器支持 __proto__
        protoAugment(value, arrayMethods) // 直接覆盖当前数组对象原型上的原生数组方法
      } else {
        copyAugment(value, arrayMethods, arrayKeys) // 直接修改原生数组对象的原型
      }
      // 如果是数组，遍历数组的每一个成员进行 observe
      this.observeArray(value)
    } else {
      // 如果是对象，则遍历对象的 key，将对象上每个属性都变成响应式
      this.walk(value)
    }
  }

  /**
   * Walk through all properties and convert them into
   * getter/setters. This method should only be called when
   * value type is Object.
   *
   * 遍历对象的 key，将对象上每个属性都变成响应式
   */
  walk (obj: Object) {
    const keys = Object.keys(obj)
    for (let i = 0; i < keys.length; i++) {
      defineReactive(obj, keys[i])
    }
  }

  /**
   * Observe a list of Array items.
   */
  observeArray (items: Array<any>) {
    for (let i = 0, l = items.length; i < l; i++) {
      observe(items[i])
    }
  }
}

// helpers

/**
 * Augment a target Object or Array by intercepting
 * the prototype chain using __proto__
 * 直接覆盖原型的方法来修改目标对象或数组
 */
function protoAugment (target, src: Object) {
  /* eslint-disable no-proto */
  target.__proto__ = src
  /* eslint-enable no-proto */
}

/**
 * Augment a target Object or Array by defining
 * hidden properties.
 *
 * 定义（覆盖）目标对象或数组的某一个方法
 */
/* istanbul ignore next */
function copyAugment (target: Object, src: Object, keys: Array<string>) {
  for (let i = 0, l = keys.length; i < l; i++) {
    const key = keys[i]
    def(target, key, src[key])
  }
}

/**
 * Attempt to create an observer instance for a value,
 * returns the new observer if successfully observed,
 * or the existing observer if the value already has one.
 *
 * 监测数据的变化
 */
export function observe (value: any, asRootData: ?boolean): Observer | void {
  // 不能监测非对象或者 vnode
  if (!isObject(value) || value instanceof VNode) {
    return
  }
  let ob: Observer | void
  // 已经有 __ob__ 属性了，不需要重复添加
  if (hasOwn(value, '__ob__') && value.__ob__ instanceof Observer) {
    ob = value.__ob__
  } else if (
    // 这里的判断是为了确保 value 是单纯的对象，而不是函数或者是 Regexp 等情况
    // 而且该对象在 shouldConvert 的时候才会进行Observer。这是一个标识位，避免重复对 value 进行 observe
    shouldObserve &&
    !isServerRendering() &&
    (Array.isArray(value) || isPlainObject(value)) &&
    Object.isExtensible(value) &&
    !value._isVue
  ) {
    ob = new Observer(value) // 实例 Observer
  }
  if (asRootData && ob) {
    ob.vmCount++
  }
  return ob
}

/**
 * Define a reactive property on an Object.
 *
 * 将对象上的一个属性变成响应式（改写对象该属性的 getter 和 setter）
 */
export function defineReactive (
  obj: Object,
  key: string,
  val: any,
  customSetter?: ?Function,
  shallow?: boolean
) {
  const dep = new Dep() // 存储订阅该属性的订阅者（watcher）

  // 获取该属性的属性描述符
  const property = Object.getOwnPropertyDescriptor(obj, key)
  if (property && property.configurable === false) { // 该属性不可被配置，无法重新定义 getter 和 setter
    return
  }

  // cater for pre-defined getter/setters
  // 如果之前该对象已经预设了 getter 以及 setter 函数则将其取出来，新定义的 getter/setter 中会将其执行，保证不会覆盖之前已经定义的 getter/setter
  const getter = property && property.get // 该属性的 getter
  const setter = property && property.set // 该属性的 setter
  if ((!getter || setter) && arguments.length === 2) {
    val = obj[key]
  }

  // 该属性的值为对象，对子对象递归调用 observe，保证每个子对象里的属性都变成响应式
  let childOb = !shallow && observe(val)
  // ！！！核心！！！
  // 给对象的该属性重新定义 getter 和 setter
  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    get: function reactiveGetter () {
      // 如果原本对象拥有 getter 方法则执行
      const value = getter ? getter.call(obj) : val
      if (Dep.target) { // 当前全局正在收集依赖的 watcher
        dep.depend() // 依赖收集，将 watcher 添加进该属性的订阅者中
        // 为 Vue.set 量身定制的逻辑
        if (childOb) {
          childOb.dep.depend() // 对子对象进行依赖收集
          if (Array.isArray(value)) { // 如果值是数组，把数组每个成员都做依赖收集，如果数组的成员还是数组，则递归
            dependArray(value)
          }
        }
      }
      return value
    },
    set: function reactiveSetter (newVal) {
      const value = getter ? getter.call(obj) : val
      /* eslint-disable no-self-compare */
      if (newVal === value || (newVal !== newVal && value !== value)) {
        return
      }
      /* eslint-enable no-self-compare */
      // 开发环境下如果有自定义 setter，则执行自定义的 setter
      // 例如给了 prop 一段自定义 setter，如果对 prop 赋值会执行这段 setter 抛出警告
      if (process.env.NODE_ENV !== 'production' && customSetter) {
        customSetter()
      }
      // #7981: for accessor properties without setter
      if (getter && !setter) return
      if (setter) {
        setter.call(obj, newVal)
      } else {
        val = newVal
      }
      childOb = !shallow && observe(newVal) // 如果 shallow 为 false 将会把新值变成为响应式对象
      dep.notify() // 通知所有订阅者，是 dep 的实例方法，定义在 src/core/observer/dep.js
    }
  })
}

/**
 * Set a property on an object. Adds the new property and
 * triggers change notification if the property doesn't
 * already exist.
 *
 * 向响应式对象中添加一个属性，并确保这个新属性同样是响应式的，且通知所有订阅该对象的观察者，进行响应式处理
 */
export function set (target: Array<any> | Object, key: any, val: any): any {
  // 添加响应式属性的目标不能为 undefined 或者是基础类型值
  if (process.env.NODE_ENV !== 'production' &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(`Cannot set reactive property on undefined, null, or primitive value: ${(target: any)}`)
  }
  // 如果传入数组则在指定位置插入 val
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    target.length = Math.max(target.length, key)
    // 此时这里的 splice 已经不是原生数组的 splice 方法了
    target.splice(key, 1, val)
    return val
  }
  // 如果 target 为对象，key 已经存在，则将 val 赋值给 target[key] 并返回
  if (key in target && !(key in Object.prototype)) {
    target[key] = val
    return val
  }
  const ob = (target: any).__ob__ // 获取到 Observer 实例
  // target 不能是 Vue 实例或者 root data
  // _isVue 一个防止 vm 实例自身被观察的标志位 ，_isVue 为 true 则代表vm实例，也就是 this
  // vmCount 判断是否为根节点，存在则代表是 data 的根节点，Vue 不允许在已经创建的实例上动态添加新的根级响应式属性(root-level reactive property)
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== 'production' && warn(
      'Avoid adding reactive properties to a Vue instance or its root $data ' +
      'at runtime - declare it upfront in the data option.'
    )
    return val
  }
  // 如果没有 ob，则 target 不为响应式对象，直接赋值
  if (!ob) {
    target[key] = val
    return val
  }
  // 通过 defineReactive 把新的属性变成响应式
  defineReactive(ob.value, key, val)
  // 通知 target 的订阅者派发更新
  ob.dep.notify()
  return val
}

/**
 * Delete a property and trigger change if necessary.
 */
export function del (target: Array<any> | Object, key: any) {
  if (process.env.NODE_ENV !== 'production' &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(`Cannot delete reactive property on undefined, null, or primitive value: ${(target: any)}`)
  }
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    target.splice(key, 1)
    return
  }
  const ob = (target: any).__ob__
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== 'production' && warn(
      'Avoid deleting properties on a Vue instance or its root $data ' +
      '- just set it to null.'
    )
    return
  }
  if (!hasOwn(target, key)) {
    return
  }
  delete target[key]
  if (!ob) {
    return
  }
  ob.dep.notify()
}

/**
 * Collect dependencies on array elements when the array is touched, since
 * we cannot intercept array element access like property getters.
 */
function dependArray (value: Array<any>) {
  for (let e, i = 0, l = value.length; i < l; i++) {
    e = value[i]
    e && e.__ob__ && e.__ob__.dep.depend()
    if (Array.isArray(e)) {
      dependArray(e)
    }
  }
}
