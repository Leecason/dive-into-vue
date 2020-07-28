/* @flow */

import { toArray } from '../util/index'

export function initUse (Vue: GlobalAPI) {
  Vue.use = function (plugin: Function | Object) {
    // 防止插件重复安装
    const installedPlugins = (this._installedPlugins || (this._installedPlugins = []))
    if (installedPlugins.indexOf(plugin) > -1) {
      return this
    }

    // additional parameters
     // 拿到安装插件的参数，将第一个参数从 plugin 替换为 Vue
     // 使得调用安装插件方法时的第一个参数为 Vue
    const args = toArray(arguments, 1)
    args.unshift(this)
    // 安装插件
    if (typeof plugin.install === 'function') {
      plugin.install.apply(plugin, args)
    } else if (typeof plugin === 'function') {
      plugin.apply(null, args)
    }
    installedPlugins.push(plugin) // 缓存已经安装的插件，避免重复安装
    return this
  }
}
