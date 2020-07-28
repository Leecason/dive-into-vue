/*
 * not type checking this file because flow doesn't play well with
 * dynamically accessing methods on Array prototype
 */

import { def } from '../util/index'

// 获取原生数组的原型对象
const arrayProto = Array.prototype
// 创建一个新的数组对象，继承自原生数组，修改该对象上的数组的七个方法，防止污染原生数组方法
export const arrayMethods = Object.create(arrayProto)

// 这里重写了数组的这些方法，在保证不污染原生数组原型的情况下重写数组的这些方法
// 截获数组成员发生的变化，执行原生数组操作的同时通知关联的所有观察者进行响应式处理
const methodsToPatch = [
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse'
]

/**
 * Intercept mutating methods and emit events
 */
methodsToPatch.forEach(function (method) {
  // cache original method
  // 将数组的原生方法缓存起来，后面要调用
  const original = arrayProto[method]
  def(arrayMethods, method, function mutator (...args) {
    // 调用原生的数组方法
    const result = original.apply(this, args)
    // 数组新插入的元素需要重新进行 observe 才能响应式
    const ob = this.__ob__
    // 对其中能增加数组长度的 3 个方法做了判断，获取到插入的值
    let inserted
    switch (method) {
      case 'push':
      case 'unshift':
        inserted = args
        break
      case 'splice':
        inserted = args.slice(2)
        break
    }
    // 将新插入的值进行 observe 变为响应式
    if (inserted) ob.observeArray(inserted)
    // notify change
    // 通知所有订阅的观察者，进行响应式处理
    ob.dep.notify()
    return result
  })
})
