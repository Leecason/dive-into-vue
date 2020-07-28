/* @flow */

import { makeMap, isBuiltInTag, cached, no } from 'shared/util'

let isStaticKey
let isPlatformReservedTag

const genStaticKeysCached = cached(genStaticKeys)

/**
 * Goal of the optimizer: walk the generated template AST tree
 * and detect sub-trees that are purely static, i.e. parts of
 * the DOM that never needs to change.
 *
 * Once we detect these sub-trees, we can:
 *
 * 1. Hoist them into constants, so that we no longer need to
 *    create fresh nodes for them on each re-render;
 * 2. Completely skip them in the patching process.
 */
export function optimize (root: ?ASTElement, options: CompilerOptions) {
  if (!root) return
  isStaticKey = genStaticKeysCached(options.staticKeys || '')
  isPlatformReservedTag = options.isReservedTag || no
  // first pass: mark all non-static nodes.
  // 1. 标记静态节点
  markStatic(root)
  // second pass: mark static roots.
  // 2. 标记静态根
  markStaticRoots(root, false)
}

function genStaticKeys (keys: string): Function {
  return makeMap(
    'type,tag,attrsList,attrsMap,plain,parent,children,attrs,start,end,rawAttrsMap' +
    (keys ? ',' + keys : '')
  )
}

// 标记静态节点
function markStatic (node: ASTNode) {
  node.static = isStatic(node) // 标记是否为静态节点
  // 如果是普通元素
  if (node.type === 1) {
    // do not make component slot content static. this avoids
    // 1. components not able to mutate slot nodes
    // 2. static slot content fails for hot-reloading
    if (
      !isPlatformReservedTag(node.tag) &&
      node.tag !== 'slot' &&
      node.attrsMap['inline-template'] == null
    ) {
      return
    }
    // 遍历子节点，递归执行 markStatic
    for (let i = 0, l = node.children.length; i < l; i++) {
      const child = node.children[i]
      markStatic(child)
      if (!child.static) { // 如果有一个子节点不是静态节点，则父节点不是静态节点
        node.static = false
      }
    }
    // 如果是 v-if, v-else-if, v-else 节点
    if (node.ifConditions) {
      // 遍历 ifConditions
      for (let i = 1, l = node.ifConditions.length; i < l; i++) {
        // 拿到条件表达式中使用的节点，递归执行 markStatic
        const block = node.ifConditions[i].block
        markStatic(block)
        if (!block.static) { // 如果条件中依赖的节点不是静态节点，则父节点不是静态节点
          node.static = false
        }
      }
    }
  }
}

// 标记静态根
function markStaticRoots (node: ASTNode, isInFor: boolean) {
  // 如果是普通节点
  if (node.type === 1) {
    // 节点是静态节点或者是 v-once 指令节点
    if (node.static || node.once) {
      node.staticInFor = isInFor
    }
    // For a node to qualify as a static root, it should have children that
    // are not just static text. Otherwise the cost of hoisting out will
    // outweigh the benefits and it's better off to just always render it fresh.
    // 如果节点是静态节点，且有子节点，并且子节点不只是一个文本节点，则标记为静态根
    if (node.static && node.children.length && !(
      node.children.length === 1 &&
      node.children[0].type === 3
    )) {
      node.staticRoot = true
      return
    } else {
      node.staticRoot = false
    }
    // 遍历子节点递归执行 markStaticRoots
    if (node.children) {
      for (let i = 0, l = node.children.length; i < l; i++) {
        markStaticRoots(node.children[i], isInFor || !!node.for)
      }
    }
    // 遍历设置了 v-if, v-else-if, v-else 的节点递归执行 markStaticRoots
    if (node.ifConditions) {
      for (let i = 1, l = node.ifConditions.length; i < l; i++) {
        markStaticRoots(node.ifConditions[i].block, isInFor)
      }
    }
  }
}

// 判断节点是否是静态节点
function isStatic (node: ASTNode): boolean {
  // 如果是表达式，则不是静态节点
  if (node.type === 2) { // expression
    return false
  }
  // 如果是纯文本，则是静态节点
  if (node.type === 3) { // text
    return true
  }
  // 对于普通节点
  // 如果有 pre 属性，则表示使用了 v-pre，是静态节点
  // 否则需要同时满足以下条件才是静态节点：
  //  1. 没有动态绑定
  //  2. 没有使用 v-if，v-for，v-else
  //  3. 不是内置组件
  //  4. 是平台保留标签
  //  5. 不是 v-for 的 template 标签的直接子节点
  //  6. 所有节点的 key 都是静态 key
  return !!(node.pre || (
    !node.hasBindings && // no dynamic bindings
    !node.if && !node.for && // not v-if or v-for or v-else
    !isBuiltInTag(node.tag) && // not a built-in
    isPlatformReservedTag(node.tag) && // not a component
    !isDirectChildOfTemplateFor(node) &&
    Object.keys(node).every(isStaticKey)
  ))
}

function isDirectChildOfTemplateFor (node: ASTElement): boolean {
  while (node.parent) {
    node = node.parent
    if (node.tag !== 'template') {
      return false
    }
    if (node.for) {
      return true
    }
  }
  return false
}
