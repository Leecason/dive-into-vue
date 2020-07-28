/* @flow */
// 自定义事件的正则匹配表达式
// 匹配函数表达式，匹配的情况：=> 箭头函数形式或者 function() 形式
const fnExpRE = /^([\w$_]+|\([^)]*?\))\s*=>|^function(?:\s+[\w$]+)?\s*\(/
const fnInvokeRE = /\([^)]*?\);*$/
// 匹配简单函数，匹配的情况：a 、a.b 、a['b'] 、a["b"] 、a[0] 、a[b]
const simplePathRE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\['[^']*?']|\["[^"]*?"]|\[\d+]|\[[A-Za-z_$][\w$]*])*$/

// KeyboardEvent.keyCode aliases
const keyCodes: { [key: string]: number | Array<number> } = {
  esc: 27,
  tab: 9,
  enter: 13,
  space: 32,
  up: 38,
  left: 37,
  right: 39,
  down: 40,
  'delete': [8, 46]
}

// KeyboardEvent.key aliases
const keyNames: { [key: string]: string | Array<string> } = {
  // #7880: IE11 and Edge use `Esc` for Escape key name.
  esc: ['Esc', 'Escape'],
  tab: 'Tab',
  enter: 'Enter',
  // #9112: IE11 uses `Spacebar` for Space key name.
  space: [' ', 'Spacebar'],
  // #7806: IE11 uses key names without `Arrow` prefix for arrow keys.
  up: ['Up', 'ArrowUp'],
  left: ['Left', 'ArrowLeft'],
  right: ['Right', 'ArrowRight'],
  down: ['Down', 'ArrowDown'],
  // #9112: IE11 uses `Del` for Delete key name.
  'delete': ['Backspace', 'Delete', 'Del']
}

// #4868: modifiers that prevent the execution of the listener
// need to explicitly return null so that we can determine whether to remove
// the listener for .once
// 生成事件导航守卫代码
const genGuard = condition => `if(${condition})return null;`

// 各种事件修饰符对应的代码
const modifierCode: { [key: string]: string } = {
  stop: '$event.stopPropagation();',
  prevent: '$event.preventDefault();',
  self: genGuard(`$event.target !== $event.currentTarget`),
  ctrl: genGuard(`!$event.ctrlKey`),
  shift: genGuard(`!$event.shiftKey`),
  alt: genGuard(`!$event.altKey`),
  meta: genGuard(`!$event.metaKey`),
  left: genGuard(`'button' in $event && $event.button !== 0`),
  middle: genGuard(`'button' in $event && $event.button !== 1`),
  right: genGuard(`'button' in $event && $event.button !== 2`)
}

// 将 AST 元素上的 events 和 nativeEvents 属性生成与事件相关的代码串
export function genHandlers (
  events: ASTElementHandlers,
  isNative: boolean
): string {
  const prefix = isNative ? 'nativeOn:' : 'on:'
  let staticHandlers = ``
  let dynamicHandlers = ``
  // 遍历 events，拿到事件名 name
  for (const name in events) {
    const handlerCode = genHandler(events[name]) // 调用 genHandler 生成代码
    if (events[name] && events[name].dynamic) {
      dynamicHandlers += `${name},${handlerCode},`
    } else {
      staticHandlers += `"${name}":${handlerCode},`
    }
  }
  staticHandlers = `{${staticHandlers.slice(0, -1)}}` // 将代码串使用 `{}` 包裹
  // 拼接上前缀
  if (dynamicHandlers) {
    return prefix + `_d(${staticHandlers},[${dynamicHandlers.slice(0, -1)}])`
  } else {
    return prefix + staticHandlers
  }
}

// Generate handler code with binding params on Weex
/* istanbul ignore next */
function genWeexHandler (params: Array<any>, handlerCode: string) {
  let innerHandlerCode = handlerCode
  const exps = params.filter(exp => simplePathRE.test(exp) && exp !== '$event')
  const bindings = exps.map(exp => ({ '@binding': exp }))
  const args = exps.map((exp, i) => {
    const key = `$_${i + 1}`
    innerHandlerCode = innerHandlerCode.replace(exp, key)
    return key
  })
  args.push('$event')
  return '{\n' +
    `handler:function(${args.join(',')}){${innerHandlerCode}},\n` +
    `params:${JSON.stringify(bindings)}\n` +
    '}'
}

// 根据 handler 生成代码，handler 可能为对象或者为数组
function genHandler (handler: ASTElementHandler | Array<ASTElementHandler>): string {
  if (!handler) { // 如果没有 handler，返回空函数的代码串
    return 'function(){}'
  }

  if (Array.isArray(handler)) { // 如果 handler 是数组
    // 对每个成员递归调用 genHandler，通过 `,` 连接起来，外层用 `[]` 包裹（表示数组）
    return `[${handler.map(handler => genHandler(handler)).join(',')}]`
  }

  const isMethodPath = simplePathRE.test(handler.value) // 是否匹配简单表达式，如 @click="a"，@click="a.b"
  const isFunctionExpression = fnExpRE.test(handler.value) // 是否匹配函数形式表达式，如 @click="function() {}"
  const isFunctionInvocation = simplePathRE.test(handler.value.replace(fnInvokeRE, ''))

  if (!handler.modifiers) { // 没事件有修饰符
    if (isMethodPath || isFunctionExpression) {
      return handler.value // 直接返回 handler.value，如返回 `a`, `a.b`，`function() {}`
    }
    /* istanbul ignore if */
    if (__WEEX__ && handler.params) {
      return genWeexHandler(handler.params, handler.value)
    }
    // 如果不满足上述的正则匹配，如 `@click="clickHandler($event)"`
    // 则在外面包裹一个传入了 $event 的 function，函数体为 `clickHandler($event)`
    // 最终返回结果为 `function($event){clickHandler($event)}`
    return `function($event){${
      isFunctionInvocation ? `return ${handler.value}` : handler.value
    }}` // inline statement
  } else { // 有事件修饰符
    let code = ''
    let genModifierCode = '' // 修饰符对应的代码串
    const keys = [] // 键盘上的键对应 key 的数组
    for (const key in handler.modifiers) { // 遍历修饰符
      if (modifierCode[key]) { // 如果有对应的修饰符代码串
        genModifierCode += modifierCode[key] // 拼接修饰符代码串
        // left/right
        if (keyCodes[key]) { // 如果有对应的键盘修饰符
          keys.push(key) // 添加进键盘 keys 数组
        }
      } else if (key === 'exact') {
        const modifiers: ASTModifiers = (handler.modifiers: any)
        genModifierCode += genGuard(
          ['ctrl', 'shift', 'alt', 'meta']
            .filter(keyModifier => !modifiers[keyModifier])
            .map(keyModifier => `$event.${keyModifier}Key`)
            .join('||')
        )
      } else {
        keys.push(key)
      }
    }
    if (keys.length) {
      code += genKeyFilter(keys) // 拼接键盘逻辑对应代码串
    }
    // Make sure modifiers like prevent and stop get executed after key filtering
    if (genModifierCode) {
      code += genModifierCode // 拼接修饰符对应代码串
    }

    // 生成回调函数代码串
    // 根据 handler.value 正则匹配结果生成函数代码串，与没有修饰符时的生成逻辑相同
    const handlerCode = isMethodPath
      ? `return ${handler.value}($event)`
      : isFunctionExpression
        ? `return (${handler.value})($event)`
        : isFunctionInvocation
          ? `return ${handler.value}`
          : handler.value
    /* istanbul ignore if */
    if (__WEEX__ && handler.params) {
      return genWeexHandler(handler.params, code + handlerCode)
    }
    return `function($event){${code}${handlerCode}}` // 最终会将键盘逻辑代码串和修饰符代码串放在回调函数代码串前面
  }
}

function genKeyFilter (keys: Array<string>): string {
  return (
    // make sure the key filters only apply to KeyboardEvents
    // #9441: can't use 'keyCode' in $event because Chrome autofill fires fake
    // key events that do not have keyCode property...
    `if(!$event.type.indexOf('key')&&` +
    `${keys.map(genFilterCode).join('&&')})return null;`
  )
}

function genFilterCode (key: string): string {
  const keyVal = parseInt(key, 10)
  if (keyVal) {
    return `$event.keyCode!==${keyVal}`
  }
  const keyCode = keyCodes[key]
  const keyName = keyNames[key]
  return (
    `_k($event.keyCode,` +
    `${JSON.stringify(key)},` +
    `${JSON.stringify(keyCode)},` +
    `$event.key,` +
    `${JSON.stringify(keyName)}` +
    `)`
  )
}
