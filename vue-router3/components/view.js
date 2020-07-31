import { warn } from '../util/warn'
import { extend } from '../util/misc'

export default {
  name: 'RouterView',
  functional: true, // 函数式组件，渲染依赖 render 函数
  props: {
    // 视图名称
    name: {
      type: String,
      default: 'default'
    }
  },
  // 函数式组件没有 vue 实例，render 方法提供第二个参数（context）作为上下文
  render (_, { props, children, parent, data }) {
    // used by devtools to display a router-view badge
    data.routerView = true // 标记为 <router-view> 组件

    // directly use parent context's createElement() function
    // so that components rendered by router-view can resolve named slots

    const h = parent.$createElement // 获取父 vue 实例的 createElement 方法
    const name = props.name // 视图名称

    // <router-view> 的重新渲染依赖这一步
    // 这里访问 parent.$route 获取当前路径，相当于访问根实例的 _route，由于根 Vue 实例的 _route 是响应式的，这里会触发 getter
    // 当路由改变时会更新根实例的 _route，触发 setter，所以会重新渲染 <router-view>
    const route = parent.$route
    const cache = parent._routerViewCache || (parent._routerViewCache = {})

    // determine current view depth, also check to see if the tree
    // has been toggled inactive but kept-alive.
    let depth = 0 // <router-view> 是支持嵌套的，表示嵌套的深度，最上层为 0
    let inactive = false
    // 计算当前 <router-view> 组件嵌套的深度
    // 从当前 <router-view> 的父节点向上找，直到根 vue 实例
    while (parent && parent._routerRoot !== parent) {
      const vnodeData = parent.$vnode ? parent.$vnode.data : {}
      // 向上查找过程中如果遇到父节点也是 <router-view> 组件，深度 + 1
      if (vnodeData.routerView) {
        depth++
      }
      if (vnodeData.keepAlive && parent._directInactive && parent._inactive) {
        inactive = true
      }
      parent = parent.$parent
    }
    data.routerViewDepth = depth // 记录当前 <router-view> 的嵌套深度

    // render previous view if the tree is inactive and kept-alive
    if (inactive) {
      const cachedData = cache[name]
      const cachedComponent = cachedData && cachedData.component
      if (cachedComponent) {
        // #2301
        // pass props
        if (cachedData.configProps) {
          fillPropsinData(cachedComponent, data, cachedData.route, cachedData.configProps)
        }
        return h(cachedComponent, data, children)
      } else {
        // render previous empty view
        return h()
      }
    }

    // route.matched 为当前路径匹配的所有路由 record，顺序为先父后子，也就是对应路由层级从浅到深
    // 所以可以根据 <router-view> 组件的嵌套深度获取到当前的路由 record
    const matched = route.matched[depth]
    const component = matched && matched.components[name] // 根据路由 record 和视图名称获取到对应的路由组件定义

    // render empty node if no matched route or no config component
    // 如果没有匹配的 record 或路由组件，渲染注释节点
    if (!matched || !component) {
      cache[name] = null
      return h()
    }

    // cache component
    // 缓存路由组件
    cache[name] = { component }

    // attach instance registration hook
    // this will be called in the instance's injected lifecycle hooks

    // 定义注册路由组件实例的方法，在 record 上添加「视图名称」到「路由组件实例」的映射
    // VueRouter 插件在安装时向全局混入了 beforeCreate 和 destroyed 钩子，该方法将在这两个钩子中被调用（因为在组件生命周期中才能拿到 vue 实例）
    // 路由组件实例会在导航守卫中使用，作为组件导航守卫钩子函数的执行上下文
    data.registerRouteInstance = (vm, val) => {
      // val could be undefined for unregistration
      const current = matched.instances[name]
      if (
        (val && current !== vm) ||
        (!val && current === vm)
      ) {
        // 在 record.instances 上添加「视图名称」到「路由组件实例」的映射
        matched.instances[name] = val
      }
    }

    // also register instance in prepatch hook
    // in case the same component instance is reused across different routes
    ;(data.hook || (data.hook = {})).prepatch = (_, vnode) => {
      matched.instances[name] = vnode.componentInstance
    }

    // register instance in init hook
    // in case kept-alive component be actived when routes changed
    data.hook.init = (vnode) => {
      if (vnode.data.keepAlive &&
        vnode.componentInstance &&
        vnode.componentInstance !== matched.instances[name]
      ) {
        matched.instances[name] = vnode.componentInstance
      }
    }

    // 路由组件传参
    // 获取路由配置里需要传入路由组件的 props
    const configProps = matched.props && matched.props[name]
    // save route and configProps in cache
    if (configProps) {
      extend(cache[name], {
        route,
        configProps
      })
      fillPropsinData(component, data, route, configProps)
    }

    return h(component, data, children)
  }
}

function fillPropsinData (component, data, route, configProps) {
  // resolve props
  let propsToPass = data.props = resolveProps(route, configProps)
  if (propsToPass) {
    // clone to prevent mutation
    propsToPass = data.props = extend({}, propsToPass)
    // pass non-declared props as attrs
    const attrs = data.attrs = data.attrs || {}
    for (const key in propsToPass) {
      if (!component.props || !(key in component.props)) {
        attrs[key] = propsToPass[key]
        delete propsToPass[key]
      }
    }
  }
}

function resolveProps (route, config) {
  switch (typeof config) {
    case 'undefined':
      return
    case 'object':
      return config
    case 'function':
      return config(route)
    case 'boolean':
      return config ? route.params : undefined
    default:
      if (process.env.NODE_ENV !== 'production') {
        warn(
          false,
          `props in "${route.path}" is a ${typeof config}, ` +
          `expecting an object, function or boolean.`
        )
      }
  }
}
