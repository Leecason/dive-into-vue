/* @flow */

// 处理作用域插槽
// 得到 不同插槽 -> 生成作用域插槽内容的函数
export function resolveScopedSlots (
  fns: ScopedSlotsData, // see flow/vnode
  res?: Object,
  // the following are added in 2.6
  hasDynamicKeys?: boolean,
  contentHashKey?: number
): { [key: string]: Function, $stable: boolean } {
  res = res || { $stable: !hasDynamicKeys }
  for (let i = 0; i < fns.length; i++) {
    const slot = fns[i]
    if (Array.isArray(slot)) {
      // 如果为数组，递归调用，同时传入 res，最后的结果都写在 res 上
      resolveScopedSlots(slot, res, hasDynamicKeys)
    } else if (slot) {
      // marker for reverse proxying v-slot without scope on this.$slots
      if (slot.proxy) {
        slot.fn.proxy = true
      }
      res[slot.key] = slot.fn
    }
  }
  if (contentHashKey) {
    (res: any).$key = contentHashKey
  }
  // 返回值：{ 插槽名称: 生成作用域插槽节点的函数 }
  // 函数体在 src/compiler/codegen/index.js 的 genScopedSlot 方法中生成
  return res
}
