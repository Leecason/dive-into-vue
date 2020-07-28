/* @flow */

import { isDef } from 'shared/util'
import { isAsyncPlaceholder } from './is-async-placeholder'

// 获取子节点的第一个组件节点
export function getFirstComponentChild (children: ?Array<VNode>): ?VNode {
  if (Array.isArray(children)) {
    // 遍历子节点
    for (let i = 0; i < children.length; i++) {
      const c = children[i]
      // 如果是组件节点或者是异步组件的占位符，就会返回该节点
      if (isDef(c) && (isDef(c.componentOptions) || isAsyncPlaceholder(c))) {
        return c
      }
    }
  }
}
