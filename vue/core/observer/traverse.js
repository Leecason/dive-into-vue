/* @flow */

import { _Set as Set, isObject } from '../util/index'
import type { SimpleSet } from '../util/index'
import VNode from '../vdom/vnode'

const seenObjects = new Set()

/**
 * Recursively traverse an object to evoke all converted
 * getters, so that every nested property inside the object
 * is collected as a "deep" dependency.
 *
 * 递归遍历一个对象来触发所有子项的 getter，这样每个嵌套的属性都会被作为 deep watcher 的依赖被收集
 * 这样每一项发生变化后都会通知该 watcher 执行回调
 */
export function traverse (val: any) {
  _traverse(val, seenObjects)
  seenObjects.clear()
}

function _traverse (val: any, seen: SimpleSet) {
  let i, keys
  const isA = Array.isArray(val)
  if ((!isA && !isObject(val)) || Object.isFrozen(val) || val instanceof VNode) {
    return
  }
  // 小优化：记录每次的 dep id 到 seenObjects，避免重复访问
  if (val.__ob__) {
    const depId = val.__ob__.dep.id
    if (seen.has(depId)) {
      return
    }
    seen.add(depId)
  }
  if (isA) { // 需要深度监听的目标为数组，对数组每个成员进行 traverse
    i = val.length
    while (i--) _traverse(val[i], seen)
  } else { // 需要深度监听的目标为对象，递归遍历访问每个子项，触发它们的 getter
    keys = Object.keys(val)
    i = keys.length
    while (i--) _traverse(val[keys[i]], seen)
  }
}
