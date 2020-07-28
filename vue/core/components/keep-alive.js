/* @flow */

import { isRegExp, remove } from 'shared/util'
import { getFirstComponentChild } from 'core/vdom/helpers/index'

type VNodeCache = { [key: string]: ?VNode };

// 获取组件名称
function getComponentName (opts: ?VNodeComponentOptions): ?string {
  // 组件配置的 name 属性或者标签名
  return opts && (opts.Ctor.options.name || opts.tag)
}

// name 是否匹配 pattern，pattern 可以为字符串，正则或者数组
function matches (pattern: string | RegExp | Array<string>, name: string): boolean {
  if (Array.isArray(pattern)) {
    return pattern.indexOf(name) > -1
  } else if (typeof pattern === 'string') {
    return pattern.split(',').indexOf(name) > -1
  } else if (isRegExp(pattern)) {
    return pattern.test(name)
  }
  /* istanbul ignore next */
  return false
}

function pruneCache (keepAliveInstance: any /* keep-alive 组件实例 */, filter: Function /* 判断是否命中缓存的方法 */) {
  const { cache, keys, _vnode } = keepAliveInstance
  for (const key in cache) { // 遍历缓存
    const cachedNode: ?VNode = cache[key]
    if (cachedNode) {
      const name: ?string = getComponentName(cachedNode.componentOptions)
      if (name && !filter(name)) { // 组件名与传入的缓存规则不匹配，则从缓存中移除这个组件对应的 vnode
        pruneCacheEntry(cache, key, keys, _vnode)
      }
    }
  }
}

// 移除缓存
function pruneCacheEntry (
  cache: VNodeCache, // 所有缓存
  key: string, // 要移除的组件名称
  keys: Array<string>, // 所有在缓存中的组件名称
  current?: VNode // 当前正在渲染的 vnode
) {
  const cached = cache[key] // 缓存的 vnode
  // 如果要移除的缓存刚好是当前正在渲染的组件，则不执行 $destroy 销毁
  if (cached && (!current || cached.tag !== current.tag)) {
    // 移除缓存 vnode 对应的的 vue 实例
    cached.componentInstance.$destroy()
  }
  // 删除缓存
  cache[key] = null
  remove(keys, key)
}

const patternTypes: Array<Function> = [String, RegExp, Array]

// keep-alive 组件
export default {
  name: 'keep-alive',
  abstract: true, // 抽象组件，并不渲染任何实体节点，在组件实例建立父子链关系时会忽略此组件

  props: {
    include: patternTypes, // 只有匹配的组件需要缓存
    exclude: patternTypes, // 任何匹配的组件都不缓存
    max: [String, Number] // 缓存大小，因为缓存的是 vnode 对象，有属性指向 DOM，当缓存很多时会占用内存
  },

  created () {
    this.cache = Object.create(null) // 存储缓存的对象，key 为组件名称，value 为 vnode
    this.keys = [] // 缓存的 vnode 的 key 值，下越靠前表示越少使用，越靠后表示最近使用，这里使用了 LRU 算法
  },

  destroyed () {
    // 销毁时
    // 遍历所有缓存，全部清除
    for (const key in this.cache) {
      pruneCacheEntry(this.cache, key, this.keys)
    }
  },

  mounted () {
    // 挂载时
    // 监听 include 和 exclude 变化，在变化时重新调整 cache
    // 如果节点名称与传入的规则不匹配，则移除缓存中的节点
    this.$watch('include', val => {
      pruneCache(this, name => matches(val, name))
    })
    this.$watch('exclude', val => {
      pruneCache(this, name => !matches(val, name))
    })
  },

  // <keep-alive> 的 render 函数
  render () {
    const slot = this.$slots.default // 拿到默认插槽
    // 获取插槽的第一个组件节点，一般与 <keep-alive> 搭配的是 <component> 动态组件和 <router-view>
    const vnode: VNode = getFirstComponentChild(slot)
    // 获取组件 options，只有组件才有 componentOptions
    const componentOptions: ?VNodeComponentOptions = vnode && vnode.componentOptions
    if (componentOptions) { // 只缓存组件节点，普通节点不会缓存
      // check pattern
      const name: ?string = getComponentName(componentOptions) // 获取组件名称
      const { include, exclude } = this // 获取 props 的 include 和 exclude
      // 如果组件名不匹配 include，或者匹配 exclude，则不需要做缓存，则直接返回 vnode，不进入后面的缓存逻辑
      if (
        // not included
        (include && (!name || !matches(include, name))) ||
        // excluded
        (exclude && name && matches(exclude, name))
      ) {
        return vnode
      }

      // 建立缓存
      const { cache, keys } = this
      // 定义缓存 key
      const key: ?string = vnode.key == null
        // same constructor may get registered as different local components
        // so cid alone is not enough (#3269)
        ? componentOptions.Ctor.cid + (componentOptions.tag ? `::${componentOptions.tag}` : '')
        : vnode.key

      // LRU 算法（最近最少使用）
      if (cache[key]) { // 如果命中缓存
        // vnode 的组件实例直接指向缓存的组件实例
        vnode.componentInstance = cache[key].componentInstance
        // make current key freshest
        // 处理缓存
        // 调整 keys 的顺序，将 key 放入末尾，表示最新最近使用
        remove(keys, key)
        keys.push(key)
      } else { // 没有命中缓存
        cache[key] = vnode // 添加进缓存
        keys.push(key)
        // prune oldest entry
        // 如果配置了 max 且缓存的长度超过了 max，则删除最久未使用的缓存
        if (this.max && keys.length > parseInt(this.max)) {
          // 删除最久未使用的缓存
          //（keys 第一个表示最久未使用，最后一个表示最近使用）
          pruneCacheEntry(cache, keys[0], keys, this._vnode /* 当前渲染节点对应的 vnode */ )
        }
      }

      // keepAlive 标记位
      // 标记的 vnode 为进行缓存的组件 vnode，而不是 <keep-alive> 这个组件本身
      vnode.data.keepAlive = true
    }
    // 返回 <keep-alive> 插槽内的第一个组件节点或者插槽的第一个元素
    return vnode || (slot && slot[0])
  }
}
