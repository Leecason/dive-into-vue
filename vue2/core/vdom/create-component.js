/* @flow */

import VNode from './vnode'
import { resolveConstructorOptions } from 'core/instance/init'
import { queueActivatedComponent } from 'core/observer/scheduler'
import { createFunctionalComponent } from './create-functional-component'

import {
  warn,
  isDef,
  isUndef,
  isTrue,
  isObject
} from '../util/index'

import {
  resolveAsyncComponent,
  createAsyncPlaceholder,
  extractPropsFromVNodeData
} from './helpers/index'

import {
  callHook,
  activeInstance,
  updateChildComponent,
  activateChildComponent,
  deactivateChildComponent
} from '../instance/lifecycle'

import {
  isRecyclableComponent,
  renderRecyclableComponentTemplate
} from 'weex/runtime/recycle-list/render-component-template'

// inline hooks to be invoked on component VNodes during patch
// 组件节点钩子函数，会在组件 vnode patch 过程中被调用
const componentVNodeHooks = {
  init (vnode: VNodeWithData, hydrating: boolean): ?boolean {
    if (
      vnode.componentInstance &&
      !vnode.componentInstance._isDestroyed &&
      vnode.data.keepAlive
    ) { // 命中组件的缓存渲染（被 <keep-alive> 缓存），直接执行 prepatch 钩子，不会再执行一次组件创建了，所以组件的 created，mounted 钩子都不会执行
      // kept-alive components, treat as a patch
      const mountedNode: any = vnode // work around flow
      componentVNodeHooks.prepatch(mountedNode, mountedNode)
    } else { // 在非 keepAlive 情况下（包含 keepAlive 时的首次渲染），通过组件 VNode 创建组件 Vue 实例
      const child = vnode.componentInstance = createComponentInstanceForVnode(
        vnode,
        activeInstance // 子组件的父 vue 实例，为当前激活的 vue 实例
      )
      // 挂载子组件，由于组件 vue 实例初始化时不会传入 el，所以需要自己接管 $mount 过程
      // 在 web 端下，下方代码实际上为 child.$mount(undefined, false)
      child.$mount(hydrating ? vnode.elm : undefined, hydrating /* 非服务端渲染为 false */)
    }
  },

  // patch 过程中新旧节点相同，当新 vnode 是组件 vnode 时，会调用此方法
  prepatch (oldVnode: MountedComponentVNode, vnode: MountedComponentVNode) {
    const options = vnode.componentOptions // 新的组件配置
    const child = vnode.componentInstance = oldVnode.componentInstance // 组件实例
    updateChildComponent(
      child, // 组件实例
      options.propsData, // 新的 props
      options.listeners, // 新的事件中心
      vnode, // new parent vnode
      options.children // new children
    )
  },

  // patch vnode 到 DOM 后在 invokeInsertHook 方法中调用
  insert (vnode: MountedComponentVNode) {
    const { context, componentInstance } = vnode
    if (!componentInstance._isMounted) { // 组件首次 mounted
      componentInstance._isMounted = true // mounted 标记
      callHook(componentInstance, 'mounted') // 调用子组件实例 mounted 钩子，执行顺序为先子后父
    }
    if (vnode.data.keepAlive) { // 该组件是被 <keep-alive> 包裹的组件
      if (context._isMounted) { // <keep-alive> 组件已经 mounted
        // vue-router#1212
        // During updates, a kept-alive component's child components may
        // change, so directly walking the tree here may call activated hooks
        // on incorrect children. Instead we push them into a queue which will
        // be processed after the whole patch process ended.

        // 将被包裹的组件实例添加到 activated children，在 nextTick 后调用包裹组件及子组件的 activated 钩子
        // 定义在 src/core/observer/scheduler.js
        queueActivatedComponent(componentInstance)
      } else { // <keep-alive> 组件还没有 mounted，调用包裹组件及子组件的 activated 钩子
        // 定义在 src/core/instance/lifecycle.js
        activateChildComponent(componentInstance, true /* direct */)
      }
    }
  },

  // 组件销毁的钩子方法
  destroy (vnode: MountedComponentVNode) {
    const { componentInstance } = vnode
    if (!componentInstance._isDestroyed) {
      if (!vnode.data.keepAlive) { // 普通组件的销毁，调用实例的 $destroy，在内部调用 destroyed 钩子
        componentInstance.$destroy()
      } else { // 销毁 keep-alive 缓存组件，调用组件及子组件的 deactivated 钩子
        // 定义在 src/core/instance/lifecycle.js
        deactivateChildComponent(componentInstance, true /* direct */)
      }
    }
  }
}

const hooksToMerge = Object.keys(componentVNodeHooks)

// 创建并返回组件 vnode
export function createComponent (
  Ctor: Class<Component> | Function | Object | void,
  data: ?VNodeData,
  context: Component,
  children: ?Array<VNode>,
  tag?: string
): VNode | Array<VNode> | void {
  if (isUndef(Ctor)) {
    return
  }

  // baseCtor 为 Vue 构造函数，定义在 src/core/global-api/index.js
  const baseCtor = context.$options._base

  // plain options object: turn it into a constructor
  // 当传入 Ctor 为组件配置对象时，构建子类构造函数
  if (isObject(Ctor)) {
    // 调用 Vue.extend，返回 Ctor 为子类构造函数
    Ctor = baseCtor.extend(Ctor)
  }

  // if at this stage it's not a constructor or an async component factory,
  // reject.
  if (typeof Ctor !== 'function') {
    if (process.env.NODE_ENV !== 'production') {
      warn(`Invalid Component definition: ${String(Ctor)}`, context)
    }
    return
  }

  // 组件的定义有时并不是一个普通的对象，比如异步组件，可能是一个函数，如
  // Vue.component('async-example', function (resolve, reject) {
  //   require(['./my-async-component'], resolve)
  // })

  // async component
  // 异步组件创建组件 vnode
  let asyncFactory
  if (isUndef(Ctor.cid)) {
    asyncFactory = Ctor
    Ctor = resolveAsyncComponent(asyncFactory, baseCtor)
    // 首次执行时，异步组件还没加载回来，组件构造函数 Ctor 为 undefined，则创建一个注释节点作为异步组件占位符 vnode
    // 除非使用高阶异步组件设置了 0 delay 并返回了 loading 组件，则会渲染 loading 组件
    // 组件加载回来后会触发重新渲染（在 resolveAsyncComponent 中使用了 forceRender 强制重新渲染）
    // 再次进入 resolveAsyncComponent，此时会根据不同的情况（成功/失败等），返回不同的组件给 Ctor，此时就会进入正常组件的渲染和 patch 过程
    if (Ctor === undefined) {
      // return a placeholder node for async component, which is rendered
      // as a comment node but preserves all the raw information for the node.
      // the information will be used for async server-rendering and hydration.
      // 定义在 src/core/vdom/helpers/resolve-async-component.js
      return createAsyncPlaceholder(
        asyncFactory,
        data,
        context,
        children,
        tag
      )
    }
  }

  data = data || {}

  // resolve constructor options in case global mixins are applied after
  // component constructor creation
  resolveConstructorOptions(Ctor)

  // transform component v-model data into props & events
  // 将 vnode data 中的 model 属性进行转换并添加到 props 和 events 中
  if (isDef(data.model)) {
    transformModel(Ctor.options, data)
  }

  // extract props
  // 从 vnode data 中提取 props
  const propsData = extractPropsFromVNodeData(data, Ctor, tag)

  // functional component
  if (isTrue(Ctor.options.functional)) {
    return createFunctionalComponent(Ctor, propsData, data, context, children)
  }

  // extract listeners, since these needs to be treated as
  // child component listeners instead of DOM listeners

  // 将定义的组件自定义事件暂存，之后实例组件 vnode 时作为参数传入
  const listeners = data.on
  // replace with listeners with .native modifier
  // so it gets processed during parent component patch.

  // 将 .native 修饰符的事件（原生 DOM 事件）赋值给 on
  // 因为普通节点定义的原生事件是在 data.on 中，这里将组件节点定义的原生事件 data.nativeOn 改写到 data.on 中
  // 而组件定义的自定义事件在上一步已经提取出来暂存到 listeners 变量中了
  data.on = data.nativeOn

  if (isTrue(Ctor.options.abstract)) {
    // abstract components do not keep anything
    // other than props & listeners & slot

    // work around flow
    const slot = data.slot
    data = {}
    if (slot) {
      data.slot = slot
    }
  }

  // install component management hooks onto the placeholder node
  // 安装组件钩子函数
  installComponentHooks(data)

  // return a placeholder vnode
  const name = Ctor.options.name || tag
  const vnode = new VNode(
    `vue-component-${Ctor.cid}${name ? `-${name}` : ''}`,
    data, undefined /* 组件 VNode 是没有 children 的 */, undefined, undefined, context,
    { Ctor, propsData, listeners /* 自定义事件 */, tag, children /* 传给子组件的插槽内容 */ }, /* componentOptions */
    asyncFactory
  )

  // Weex specific: invoke recycle-list optimized @render function for
  // extracting cell-slot template.
  // https://github.com/Hanks10100/weex-native-directive/tree/master/component
  /* istanbul ignore if */
  if (__WEEX__ && isRecyclableComponent(vnode)) {
    return renderRecyclableComponentTemplate(vnode)
  }

  return vnode
}

// 通过组件 vnode 创建子组件 vue 实例
export function createComponentInstanceForVnode (
  vnode: any, // we know it's MountedComponentVNode but flow doesn't
  parent: any, // activeInstance in lifecycle state
): Component {
  // 传给子组件生成 vue 实例时的一些选项
  const options: InternalComponentOptions = {
    _isComponent: true, // 表示是一个组件
    _parentVnode: vnode, // 子组件的父 vnode
    parent // 子组件的父 vue 实例
  }
  // check inline-template render functions
  const inlineTemplate = vnode.data.inlineTemplate
  if (isDef(inlineTemplate)) {
    options.render = inlineTemplate.render
    options.staticRenderFns = inlineTemplate.staticRenderFns
  }
  // vnode.componentOptions.Ctor 对应的是通过 Vue.extend 得到的子组件构造函数 Sub
  // 下方代码相当于 new Sub(options)
  return new vnode.componentOptions.Ctor(options)
}

// 安装组件钩子函数，会合并到 vnode.data.hook 中，在组件 vnode patch 过程中执行这些钩子
function installComponentHooks (data: VNodeData) {
  const hooks = data.hook || (data.hook = {})
  for (let i = 0; i < hooksToMerge.length; i++) {
    const key = hooksToMerge[i]
    const existing = hooks[key]
    const toMerge = componentVNodeHooks[key]
    // 如果钩子已经存在，则调用 mergeHook 做合并，执行时会依次执行
    if (existing !== toMerge && !(existing && existing._merged)) {
      hooks[key] = existing ? mergeHook(toMerge, existing) : toMerge
    }
  }
}

function mergeHook (f1: any, f2: any): Function {
  const merged = (a, b) => {
    // flow complains about extra args which is why we use any
    f1(a, b)
    f2(a, b)
  }
  merged._merged = true
  return merged
}

// transform component v-model info (value and callback) into
// prop and event handler respectively.

// 将 vnode data 中的 model 属性进行转换并添加到 props 和 events 中
function transformModel (options, data: any) {
  const prop = (options.model && options.model.prop) || 'value' // 默认 prop 为 value
  const event = (options.model && options.model.event) || 'input' // 默认 event 为 input
  ;(data.attrs || (data.attrs = {}))[prop] = data.model.value // 新增 prop
  const on = data.on || (data.on = {})
  const existing = on[event]
  // 合并 events
  const callback = data.model.callback
  if (isDef(existing)) {
    if (
      Array.isArray(existing)
        ? existing.indexOf(callback) === -1
        : existing !== callback
    ) {
      on[event] = [callback].concat(existing)
    }
  } else {
    on[event] = callback
  }
}
