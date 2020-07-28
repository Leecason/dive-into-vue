/* @flow */

import { warn } from './debug'
import { observe, toggleObserving, shouldObserve } from '../observer/index'
import {
  hasOwn,
  isObject,
  toRawType,
  hyphenate,
  capitalize,
  isPlainObject
} from 'shared/util'

type PropOptions = {
  type: Function | Array<Function> | null,
  default: any,
  required: ?boolean,
  validator: ?Function
};

// 校验 prop 的值是否满足定义的规范，并返回 prop 的值
export function validateProp (
  key: string, // prop 名称
  propOptions: Object, // 规范后的 props（vm.$options.props）
  propsData: Object, // 父组件传递的 props 的值
  vm?: Component // vue 实例
): any {
  const prop = propOptions[key] // 已经被规范化为对象
  const absent = !hasOwn(propsData, key) // 父组件是否传递了这个 prop 属性
  let value = propsData[key] // 父组件传递的该 prop 属性的值
  // boolean casting
  // 判断 prop 是否可以是布尔类型（prop.type 可以是单个构造函数，也可以是多个构造函数的数组）
  const booleanIndex = getTypeIndex(Boolean, prop.type)
  if (booleanIndex > -1) { // 当这个 prop 可以是布尔类型
    if (absent && !hasOwn(prop, 'default')) { // 如果父组件没传递值且没有定义 prop 的默认值，则值为 false
      value = false
    } else if (value === '' || value === hyphenate(key)) { // 如果值为空字符串或者与短杠链接形式的 prop 名称相同时
      // only cast empty string / same name to boolean if
      // boolean has higher priority
      const stringIndex = getTypeIndex(String, prop.type) // 判断 prop 是否可以是字符串类型
      // 如果 prop 的类型没有定义字符串类型，或者定义的布尔类型在字符串类型的前面（优先布尔值类型），则值为 true
      // 也就是说当一个 prop 值的类型为布尔值优先时，传的是空字符串，会将其值设为 true
      // 例如 <custom-select multiple> 此时 multiple 的值为 true
      if (stringIndex < 0 || booleanIndex < stringIndex) {
        value = true
      }
    }
  }
  // check default value
  // 处理 prop 默认值
  if (value === undefined) { // 父组件没有传递 prop
    value = getPropDefaultValue(vm, prop, key) // 获取 prop 定义的默认值
    // since the default value is a fresh copy,
    // make sure to observe it.
    // 由于父组件没有传 prop，这里的值是 prop 定义时写的默认值，属于值的拷贝
    // 所以这里要保证这个值是响应式的，需要 toggleObserving
    const prevShouldObserve = shouldObserve
    toggleObserving(true)
    observe(value)
    toggleObserving(prevShouldObserve)
  }
  if (
    process.env.NODE_ENV !== 'production' &&
    // skip validation for weex recycle-list child component props
    !(__WEEX__ && isObject(value) && ('@binding' in value))
  ) {
    assertProp(prop, key, value, vm, absent) // 断言 prop 是否合法
  }
  return value
}

/**
 * Get the default value of a prop.
 *
 * 获取 prop 定义的默认值
 */
function getPropDefaultValue (vm: ?Component, prop: PropOptions, key: string): any {
  // no default, return undefined
  if (!hasOwn(prop, 'default')) { // 如果没有定义 default 属性，返回 undefined
    return undefined
  }
  const def = prop.default
  // warn against non-factory defaults for Object & Array
  // 开发模式下，如果定义的默认值是对象或者数组类型，会报警告，它们的默认值需要返回一个工厂函数
  if (process.env.NODE_ENV !== 'production' && isObject(def)) {
    warn(
      'Invalid default value for prop "' + key + '": ' +
      'Props with type Object/Array must use a factory function ' +
      'to return the default value.',
      vm
    )
  }
  // the raw prop value was also undefined from previous render,
  // return previous default value to avoid unnecessary watcher trigger
  if (vm && vm.$options.propsData &&
    vm.$options.propsData[key] === undefined && // 上一次父组件传递的 prop 为 undefined
    vm._props[key] !== undefined
  ) {
    return vm._props[key] // 直接返回上一次 prop 的默认值，避免触发 watcher 的回调
  }
  // call factory function for non-Function types
  // a value is Function if its prototype is function even across different execution context
  // 如果默认值是函数，且 prop 类型不为 Function，则把该函数作为工厂函数使用，返回该函数的返回值，否则 prop 的值为该函数
  return typeof def === 'function' && getType(prop.type) !== 'Function'
    ? def.call(vm) // 返回调用工厂函数的返回值
    : def // 返回该函数
}

/**
 * Assert whether a prop is valid.
 * 断言 prop 是否合法，开发环境下会执行
 */
function assertProp (
  prop: PropOptions,
  name: string,
  value: any,
  vm: ?Component,
  absent: boolean // 为 true 表示父组件没传该 prop
) {
  if (prop.required && absent) { // prop 定义了 required 且父组件没传这个 prop，报警告
    warn(
      'Missing required prop: "' + name + '"',
      vm
    )
    return
  }
  if (value == null && !prop.required) { // 没有传值且非 required，直接返回
    return
  }
  let type = prop.type // 获取定义的 prop 类型
  let valid = !type || type === true
  const expectedTypes = []
  if (type) {
    if (!Array.isArray(type)) { // 规范化 type 为数组
      type = [type]
    }
    // 遍历定义的类型，直到找到一个合法的类型，则退出循环，并设置 valid 为 true
    for (let i = 0; i < type.length && !valid; i++) {
      const assertedType = assertType(value, type[i])
      expectedTypes.push(assertedType.expectedType || '')
      valid = assertedType.valid
    }
  }

  if (!valid) { // prop 的值与定义的类型不匹配，则报警告
    warn(
      getInvalidTypeMessage(name, value, expectedTypes),
      vm
    )
    return
  }
  // 定义了自定义的校验器，则执行校验器方法
  const validator = prop.validator
  if (validator) {
    if (!validator(value)) {
      warn(
        'Invalid prop: custom validator check failed for prop "' + name + '".',
        vm
      )
    }
  }
}

const simpleCheckRE = /^(String|Number|Boolean|Function|Symbol)$/

// 断言 prop 类型
function assertType (value: any, type: Function): {
  valid: boolean;
  expectedType: string;
} {
  let valid
  const expectedType = getType(type) // 获取构造函数名称
  if (simpleCheckRE.test(expectedType)) { // 构造函数是否为一组简单的原生类型
    const t = typeof value
    valid = t === expectedType.toLowerCase() // 通过 typeof 判断 value 是否是这几种简单类型
    // for primitive wrapper objects
    if (!valid && t === 'object') { // typeof value 为 object
      valid = value instanceof type // 判断 value 是否是基础类型的包装器对象，如 new String('1'), new Number(2)
    }
  } else if (expectedType === 'Object') { // 构造函数名称是 Object
    valid = isPlainObject(value) // 判断 value 是否是纯对象
  } else if (expectedType === 'Array') { // 构造函数名称是 Array
    valid = Array.isArray(value) // 通过 isArray 判断是否满足
  } else { // 否则，判断 value 是否是构造函数的实例
    valid = value instanceof type
  }
  return {
    valid,
    expectedType
  }
}

/**
 * Use function string name to check built-in types,
 * because a simple equality check will fail when running
 * across different vms / iframes.
 *
 * 获取给定函数的构造函数
 */
function getType (fn) {
  const match = fn && fn.toString().match(/^\s*function (\w+)/)
  return match ? match[1] : ''
}

function isSameType (a, b) {
  return getType(a) === getType(b)
}

// 找到给定 type 和 expectedTypes 相匹配的索引
function getTypeIndex (type, expectedTypes): number {
  if (!Array.isArray(expectedTypes)) { // 如果 expectedTypes 是单个构造函数
    return isSameType(expectedTypes, type) ? 0 : -1 // 判断构造函数名称是否相同返回 0 / -1
  }
  // 如果 expectedTypes 是构造函数的数组，就遍历数组，找到第一个同名构造函数的索引
  for (let i = 0, len = expectedTypes.length; i < len; i++) {
    if (isSameType(expectedTypes[i], type)) {
      return i
    }
  }
  return -1
}

function getInvalidTypeMessage (name, value, expectedTypes) {
  let message = `Invalid prop: type check failed for prop "${name}".` +
    ` Expected ${expectedTypes.map(capitalize).join(', ')}`
  const expectedType = expectedTypes[0]
  const receivedType = toRawType(value)
  const expectedValue = styleValue(value, expectedType)
  const receivedValue = styleValue(value, receivedType)
  // check if we need to specify expected value
  if (expectedTypes.length === 1 &&
      isExplicable(expectedType) &&
      !isBoolean(expectedType, receivedType)) {
    message += ` with value ${expectedValue}`
  }
  message += `, got ${receivedType} `
  // check if we need to specify received value
  if (isExplicable(receivedType)) {
    message += `with value ${receivedValue}.`
  }
  return message
}

function styleValue (value, type) {
  if (type === 'String') {
    return `"${value}"`
  } else if (type === 'Number') {
    return `${Number(value)}`
  } else {
    return `${value}`
  }
}

function isExplicable (value) {
  const explicitTypes = ['string', 'number', 'boolean']
  return explicitTypes.some(elem => value.toLowerCase() === elem)
}

function isBoolean (...args) {
  return args.some(elem => elem.toLowerCase() === 'boolean')
}
