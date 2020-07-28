/* @flow */

import { extend, warn, isObject } from 'core/util/index'

/**
 * Runtime helper for rendering <slot>
 *
 * 运行时渲染 <slot> 的函数
 */
export function renderSlot (
  name: string, // 插槽名称
  fallback: ?Array<VNode>, // 插槽默认内容
  props: ?Object, // 提供给作用域插槽的属性
  bindObject: ?Object
): ?Array<VNode> {
  // $scopedSlots 初始化在 src/core/instance/render.js 的 _render 方法
  // 发生在子组件 render 之前，保证运行时进入该函数能获取到 $scopedSlots 的内容
  const scopedSlotFn = this.$scopedSlots[name]
  let nodes
  if (scopedSlotFn) { // 作用域插槽
    props = props || {} // 作用域插槽的属性
    if (bindObject) {
      if (process.env.NODE_ENV !== 'production' && !isObject(bindObject)) {
        warn(
          'slot v-bind without argument expects an Object',
          this
        )
      }
      props = extend(extend({}, bindObject), props)
    }
    // 将 props 传入 scopedSlotFn 得到渲染的内容，如果没有则使用默认插槽内容
    nodes = scopedSlotFn(props) || fallback
  } else { // 默认插槽
    // 获取插槽名对应的内容（由父节点渲染好传递给子组件），如果没有则使用默认插槽内容
    // $slots 初始化在 src/core/instance/render.js 的 initRender 方法
    // 发生在子组件初始化时，保证子组件 render 时能获取到 $slots 的内容
    nodes = this.$slots[name] || fallback
  }

  const target = props && props.slot
  if (target) {
    return this.$createElement('template', { slot: target }, nodes)
  } else {
    // 返回渲染的插槽内容
    return nodes
  }
}

// 普通插槽：在父组件编译和渲染阶段生成 vnodes，所以数据的作用域是父组件实例
// 子组件渲染时，直接拿到这些渲染好的 vnodes，进行渲染

// 作用域插槽：父组件编译和渲染阶段不会直接生成 vnodes，而是在父节点 vnode 的 data 中保留
// scopedSlots 对象，存储着不同名称的插槽以及它们对应的渲染函数，只有在渲染子组件阶段才会执行这个渲染函数
// 生成 vnodes，所以数据的作用域是子组件实例
