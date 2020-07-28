/* @flow */

import type VNode from 'core/vdom/vnode'

/**
 * Runtime helper for resolving raw children VNodes into a slot object.
 */
export function resolveSlots (
  children: ?Array<VNode>, // 父组件传入子组件的插槽内容
  context: ?Component // 父 vue 实例
): { [key: string]: Array<VNode> } {
  if (!children || !children.length) { // 没有插槽内容
    return {}
  }
  const slots = {}
  for (let i = 0, l = children.length; i < l; i++) { // 遍历插槽子节点
    const child = children[i]
    const data = child.data // vnodeData
    // remove slot attribute if the node is resolved as a Vue slot node
    if (data && data.attrs && data.attrs.slot) { // 删除具名插槽 在 codegen 时添加的 slot 属性
      delete data.attrs.slot
    }
    // named slots should only be respected if the vnode was rendered in the
    // same context.
    // 子节点因为是父组件渲染的，所以 child.context 等于父组件实例
    if ((child.context === context || child.fnContext === context) &&
      data && data.slot != null // 在 codegen 时拼接在 vnode data 上的 slot 属性，如果不为空，则为具名插槽
    ) {
      const name = data.slot // 插槽名称
      const slot = (slots[name] || (slots[name] = []))
      // 添加插槽内容
      if (child.tag === 'template') {
        slot.push.apply(slot, child.children || [])
      } else {
        slot.push(child)
      }
    } else { // 添加默认插槽内容
      (slots.default || (slots.default = [])).push(child)
    }
  }
  // ignore slots that contains only whitespace
  // 删除空白内容插槽，内容为注释节点或者空字符串
  for (const name in slots) {
    if (slots[name].every(isWhitespace)) {
      delete slots[name]
    }
  }
  // 返回 slots 对象，键为插槽名称，值为父节点渲染的 vnode 数组
  return slots
}

// 判断节点是否为空白节点（注释节点或空字符串节点）
function isWhitespace (node: VNode): boolean {
  return (node.isComment && !node.asyncFactory) || node.text === ' '
}
