/* @flow */

import config from 'core/config'
import { addHandler, addProp, getBindingAttr } from 'compiler/helpers'
import { genComponentModel, genAssignmentCode } from 'compiler/directives/model'

let warn

// in some cases, the event used has to be determined at runtime
// so we used some reserved tokens during compile.
export const RANGE_TOKEN = '__r'
export const CHECKBOX_RADIO_TOKEN = '__c'

export default function model (
  el: ASTElement, // AST 节点
  dir: ASTDirective, // 指令对象
  _warn: Function
): ?boolean {
  warn = _warn
  const value = dir.value // 指令绑定的值
  const modifiers = dir.modifiers // 指令修饰符
  const tag = el.tag // 元素标签
  const type = el.attrsMap.type

  // 不允许在 file input 上使用 v-model，因为 file input 是 readonly 的
  if (process.env.NODE_ENV !== 'production') {
    // inputs with type="file" are read only and setting the input's
    // value will throw an error.
    if (tag === 'input' && type === 'file') {
      warn(
        `<${el.tag} v-model="${value}" type="file">:\n` +
        `File inputs are read only. Use a v-on:change listener instead.`,
        el.rawAttrsMap['v-model']
      )
    }
  }

  if (el.component) { // AST 节点是组件
    genComponentModel(el, value, modifiers)
    // component v-model doesn't need extra runtime
    return false
  } else if (tag === 'select') { // select 标签
    genSelect(el, value, modifiers)
  } else if (tag === 'input' && type === 'checkbox') { // checkbox 类型的 input
    genCheckboxModel(el, value, modifiers)
  } else if (tag === 'input' && type === 'radio') { // radio 类型的 input
    genRadioModel(el, value, modifiers)
  } else if (tag === 'input' || tag === 'textarea') { // input 或者 textarea
    genDefaultModel(el, value, modifiers)
  } else if (!config.isReservedTag(tag)) { // tag 不是保留字，组件 v-model
    genComponentModel(el, value, modifiers)
    // component v-model doesn't need extra runtime
    return false
  } else if (process.env.NODE_ENV !== 'production') { // 非生产环境，报警告 v-model 不支持该 el
    warn(
      `<${el.tag} v-model="${value}">: ` +
      `v-model is not supported on this element type. ` +
      'If you are working with contenteditable, it\'s recommended to ' +
      'wrap a library dedicated for that purpose inside a custom component.',
      el.rawAttrsMap['v-model']
    )
  }

  // ensure runtime directive metadata
  // 返回值为 true，需要一些运行时逻辑的支持
  return true
}

function genCheckboxModel (
  el: ASTElement,
  value: string,
  modifiers: ?ASTModifiers
) {
  const number = modifiers && modifiers.number
  const valueBinding = getBindingAttr(el, 'value') || 'null'
  const trueValueBinding = getBindingAttr(el, 'true-value') || 'true'
  const falseValueBinding = getBindingAttr(el, 'false-value') || 'false'
  addProp(el, 'checked',
    `Array.isArray(${value})` +
    `?_i(${value},${valueBinding})>-1` + (
      trueValueBinding === 'true'
        ? `:(${value})`
        : `:_q(${value},${trueValueBinding})`
    )
  )
  addHandler(el, 'change',
    `var $$a=${value},` +
        '$$el=$event.target,' +
        `$$c=$$el.checked?(${trueValueBinding}):(${falseValueBinding});` +
    'if(Array.isArray($$a)){' +
      `var $$v=${number ? '_n(' + valueBinding + ')' : valueBinding},` +
          '$$i=_i($$a,$$v);' +
      `if($$el.checked){$$i<0&&(${genAssignmentCode(value, '$$a.concat([$$v])')})}` +
      `else{$$i>-1&&(${genAssignmentCode(value, '$$a.slice(0,$$i).concat($$a.slice($$i+1))')})}` +
    `}else{${genAssignmentCode(value, '$$c')}}`,
    null, true
  )
}

function genRadioModel (
  el: ASTElement,
  value: string,
  modifiers: ?ASTModifiers
) {
  const number = modifiers && modifiers.number
  let valueBinding = getBindingAttr(el, 'value') || 'null'
  valueBinding = number ? `_n(${valueBinding})` : valueBinding
  addProp(el, 'checked', `_q(${value},${valueBinding})`)
  addHandler(el, 'change', genAssignmentCode(value, valueBinding), null, true)
}

function genSelect (
  el: ASTElement,
  value: string,
  modifiers: ?ASTModifiers
) {
  const number = modifiers && modifiers.number
  const selectedVal = `Array.prototype.filter` +
    `.call($event.target.options,function(o){return o.selected})` +
    `.map(function(o){var val = "_value" in o ? o._value : o.value;` +
    `return ${number ? '_n(val)' : 'val'}})`

  const assignment = '$event.target.multiple ? $$selectedVal : $$selectedVal[0]'
  let code = `var $$selectedVal = ${selectedVal};`
  code = `${code} ${genAssignmentCode(value, assignment)}`
  addHandler(el, 'change', code, null, true)
}

// 文本输入类型 input 或 textarea 生成 v-model 的代码
function genDefaultModel (
  el: ASTElement, // AST 节点
  value: string, // 绑定的值
  modifiers: ?ASTModifiers // 修饰符
): ?boolean {
  const type = el.attrsMap.type

  // warn if v-bind:value conflicts with v-model
  // except for inputs with v-bind:type

  // 对非生产环境下对 v-bind:value 和 v-model 的冲突进行警告
  if (process.env.NODE_ENV !== 'production') {
    const value = el.attrsMap['v-bind:value'] || el.attrsMap[':value']
    const typeBinding = el.attrsMap['v-bind:type'] || el.attrsMap[':type']
    if (value && !typeBinding) {
      const binding = el.attrsMap['v-bind:value'] ? 'v-bind:value' : ':value'
      warn(
        `${binding}="${value}" conflicts with v-model on the same element ` +
        'because the latter already expands to a value binding internally',
        el.rawAttrsMap[binding]
      )
    }
  }

  const { lazy, number, trim } = modifiers || {} // 获取修饰符
  const needCompositionGuard = !lazy && type !== 'range'
  const event = lazy // 根据修饰符判断对应的 event
    ? 'change'
    : type === 'range'
      ? RANGE_TOKEN
      : 'input'

  // 根据修饰符得到代码表达式
  let valueExpression = '$event.target.value'
  if (trim) { // trim 修饰符会过滤掉首尾空白
    valueExpression = `$event.target.value.trim()`
  }
  if (number) { // 将用户输入转换为 number 类型
    valueExpression = `_n(${valueExpression})`
  }

  // `genAssignmentCode` 是一个跨平台的代码生成辅助方法，定义在 src/compiler/directives/model.js
  // 返回值是一段赋值代码
  // 例如一般情况 v-model="text"，value 为 `text`, valueExpression 为 `$event.target.value`
  // 返回的赋值代码为 `text = $event.target.value`
  let code = genAssignmentCode(value, valueExpression)
  if (needCompositionGuard) {
    // v-model 写法和 value + input 写法的区别
    // 为了保证不会在输入法组合文字的过程中触发更新
    code = `if($event.target.composing)return;${code}`
  }

  addProp(el, 'value', `(${value})`) // 给 el 添加名为 value 的 prop，对应值为 v-model 绑定的值
  addHandler(el, event, code, null, true) // 给 el 添加一个事件，回调函数为上面生成的赋值代码
  if (trim || number) { // 如果有 trim 和 number 的修饰符，则添加 blur 事件，回调函数为 $forceUpdate
    addHandler(el, 'blur', '$forceUpdate()')
  }
}
