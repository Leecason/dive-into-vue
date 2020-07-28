/* @flow */

import { emptyObject } from 'shared/util'
import { parseFilters } from './parser/filter-parser'

type Range = { start?: number, end?: number };

/* eslint-disable no-unused-vars */
export function baseWarn (msg: string, range?: Range) {
  console.error(`[Vue compiler]: ${msg}`)
}
/* eslint-enable no-unused-vars */

export function pluckModuleFunction<F: Function> (
  modules: ?Array<Object>,
  key: string
): Array<F> {
  return modules
    ? modules.map(m => m[key]).filter(_ => _)
    : []
}

// 给 el 添加 prop
export function addProp (el: ASTElement, name: string, value: string, range?: Range, dynamic?: boolean) {
  (el.props || (el.props = [])).push(rangeSetItem({ name, value, dynamic }, range))
  el.plain = false
}

export function addAttr (el: ASTElement, name: string, value: any, range?: Range, dynamic?: boolean) {
  const attrs = dynamic
    ? (el.dynamicAttrs || (el.dynamicAttrs = []))
    : (el.attrs || (el.attrs = []))
  attrs.push(rangeSetItem({ name, value, dynamic }, range))
  el.plain = false
}

// add a raw attr (use this in preTransforms)
export function addRawAttr (el: ASTElement, name: string, value: any, range?: Range) {
  el.attrsMap[name] = value
  el.attrsList.push(rangeSetItem({ name, value }, range))
}

export function addDirective (
  el: ASTElement, // AST 节点
  name: string, // 指令名，不包括 v- 前缀
  rawName: string,
  value: string, // 绑定的值，v-directive="value"
  arg: ?string, // 传给指令的参数 v-directive:arg
  isDynamicArg: boolean, // 是否为动态参数 v-directive:[arg]
  modifiers: ?ASTModifiers, // 指令修饰符 v-directive.foo.bar
  range?: Range
) {
  // 构造指令对象，将其添加到 el.directives 中
  (el.directives || (el.directives = [])).push(rangeSetItem({
    name,
    rawName,
    value,
    arg,
    isDynamicArg,
    modifiers
  }, range))
  el.plain = false
}

function prependModifierMarker (symbol: string, name: string, dynamic?: boolean): string {
  return dynamic
    ? `_p(${name},"${symbol}")`
    : symbol + name // mark the event as captured
}

// 添加事件处理器，目的是给 el 的 nativeEvents 或 events 上添加属性
export function addHandler (
  el: ASTElement, // AST 元素
  name: string, // 事件名
  value: string, // 事件绑定的回调表达式
  modifiers: ?ASTModifiers, // 事件修饰符
  important?: boolean, // 为 true 表示这个事件应该添加到事件列表最前面
  warn?: ?Function,
  range?: Range,
  dynamic?: boolean
) {
  modifiers = modifiers || emptyObject // 事件修饰符默认为空对象
  // warn prevent and passive modifier
  /* istanbul ignore if */
  if (
    process.env.NODE_ENV !== 'production' && warn &&
    modifiers.prevent && modifiers.passive
  ) {
    warn(
      'passive and prevent can\'t be used together. ' +
      'Passive handler can\'t prevent default event.',
      range
    )
  }

  // 1. 首先根据修饰符对事件名 name 做处理

  // normalize click.right and click.middle since they don't actually fire
  // this is technically browser-specific, but at least for now browsers are
  // the only target envs that have right/middle clicks.
  if (modifiers.right) { // right 修饰符
    if (dynamic) {
      name = `(${name})==='click'?'contextmenu':(${name})`
    } else if (name === 'click') { // 如果是 click.right 则事件名 name 将变为 contextmenu
      name = 'contextmenu'
      delete modifiers.right
    }
  } else if (modifiers.middle) { // middle 修饰符
    if (dynamic) {
      name = `(${name})==='click'?'mouseup':(${name})`
    } else if (name === 'click') { // 如果是 click.middle 则事件名 name 将变为 mouseup
      name = 'mouseup'
    }
  }

  // check capture modifier
  if (modifiers.capture) { // capture 修饰符，会在事件名 name 前面加上 `!`，会在运行时处理
    delete modifiers.capture
    name = prependModifierMarker('!', name, dynamic)
  }
  if (modifiers.once) { // once 修饰符，会在事件名 name 前面加上 `~`，会在运行时处理
    delete modifiers.once
    name = prependModifierMarker('~', name, dynamic)
  }
  /* istanbul ignore if */
  if (modifiers.passive) { // passive 修饰符，会在事件名 name 前面加上 `&`，会在运行时处理
    delete modifiers.passive
    name = prependModifierMarker('&', name, dynamic)
  }

  let events
  // 判断将 handler 添加进 nativeEvents（原生事件） 还是 events（自定义事件） 中
  if (modifiers.native) { // 如果是 native 修饰符，表示原生事件
    delete modifiers.native
    events = el.nativeEvents || (el.nativeEvents = {})
  } else {
    events = el.events || (el.events = {})
  }

  const newHandler: any = rangeSetItem({ value: value.trim(), dynamic }, range) // 构造 handler 对象
  if (modifiers !== emptyObject) { // 将修饰符添加进这个 handler 对象
    newHandler.modifiers = modifiers
  }

  const handlers = events[name]
  /* istanbul ignore if */
  // 对同一个事件名可以添加多个回调函数
  if (Array.isArray(handlers)) { // 已经对该事件添加了多次 handler
    important ? handlers.unshift(newHandler) : handlers.push(newHandler)
  } else if (handlers) { // 第二次对该事件添加 handler
    events[name] = important ? [newHandler, handlers] : [handlers, newHandler]
  } else { // 第一次对该事件添加 handler
    events[name] = newHandler
  }

  el.plain = false
}

export function getRawBindingAttr (
  el: ASTElement,
  name: string
) {
  return el.rawAttrsMap[':' + name] ||
    el.rawAttrsMap['v-bind:' + name] ||
    el.rawAttrsMap[name]
}

export function getBindingAttr (
  el: ASTElement,
  name: string,
  getStatic?: boolean
): ?string {
  const dynamicValue =
    getAndRemoveAttr(el, ':' + name) ||
    getAndRemoveAttr(el, 'v-bind:' + name)
  if (dynamicValue != null) {
    return parseFilters(dynamicValue)
  } else if (getStatic !== false) {
    const staticValue = getAndRemoveAttr(el, name)
    if (staticValue != null) {
      return JSON.stringify(staticValue)
    }
  }
}

// note: this only removes the attr from the Array (attrsList) so that it
// doesn't get processed by processAttrs.
// By default it does NOT remove it from the map (attrsMap) because the map is
// needed during codegen.
export function getAndRemoveAttr (
  el: ASTElement,
  name: string,
  removeFromMap?: boolean
): ?string {
  let val
  if ((val = el.attrsMap[name]) != null) {
    const list = el.attrsList
    for (let i = 0, l = list.length; i < l; i++) {
      if (list[i].name === name) {
        list.splice(i, 1)
        break
      }
    }
  }
  if (removeFromMap) {
    delete el.attrsMap[name]
  }
  return val
}

export function getAndRemoveAttrByRegex (
  el: ASTElement,
  name: RegExp
) {
  const list = el.attrsList
  for (let i = 0, l = list.length; i < l; i++) {
    const attr = list[i]
    if (name.test(attr.name)) {
      list.splice(i, 1)
      return attr
    }
  }
}

function rangeSetItem (
  item: any,
  range?: { start?: number, end?: number }
) {
  if (range) {
    if (range.start != null) {
      item.start = range.start
    }
    if (range.end != null) {
      item.end = range.end
    }
  }
  return item
}
