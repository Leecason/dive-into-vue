/**
 * Not type-checking this file because it's mostly vendor code.
 */

/*!
 * HTML Parser By John Resig (ejohn.org)
 * Modified by Juriy "kangax" Zaytsev
 * Original code by Erik Arvidsson (MPL-1.1 OR Apache-2.0 OR GPL-2.0-or-later)
 * http://erik.eae.net/simplehtmlparser/simplehtmlparser.js
 */

import { makeMap, no } from 'shared/util'
import { isNonPhrasingTag } from 'web/compiler/util'
import { unicodeRegExp } from 'core/util/lang'

// Regular Expressions for parsing tags and attributes
// 匹配模板字符串过程中使用到的正则表达式
const attribute = /^\s*([^\s"'<>\/=]+)(?:\s*(=)\s*(?:"([^"]*)"+|'([^']*)'+|([^\s"'=<>`]+)))?/
const dynamicArgAttribute = /^\s*((?:v-[\w-]+:|@|:|#)\[[^=]+\][^\s"'<>\/=]*)(?:\s*(=)\s*(?:"([^"]*)"+|'([^']*)'+|([^\s"'=<>`]+)))?/
const ncname = `[a-zA-Z_][\\-\\.0-9_a-zA-Z${unicodeRegExp.source}]*`
const qnameCapture = `((?:${ncname}\\:)?${ncname})`
const startTagOpen = new RegExp(`^<${qnameCapture}`) // 匹配开始标签
const startTagClose = /^\s*(\/?)>/ // 匹配开始标签闭合符
const endTag = new RegExp(`^<\\/${qnameCapture}[^>]*>`) // 匹配结束标签
const doctype = /^<!DOCTYPE [^>]+>/i // 匹配文档类型节点
// #7298: escape - to avoid being passed as HTML comment when inlined in page
const comment = /^<!\--/ // 匹配注释节点
const conditionalComment = /^<!\[/ // 匹配条件注释节点

// Special Elements (can contain anything)
export const isPlainTextElement = makeMap('script,style,textarea', true)
const reCache = {}

const decodingMap = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&amp;': '&',
  '&#10;': '\n',
  '&#9;': '\t',
  '&#39;': "'"
}
const encodedAttr = /&(?:lt|gt|quot|amp|#39);/g
const encodedAttrWithNewLines = /&(?:lt|gt|quot|amp|#39|#10|#9);/g

// #5992
const isIgnoreNewlineTag = makeMap('pre,textarea', true)
const shouldIgnoreFirstNewline = (tag, html) => tag && isIgnoreNewlineTag(tag) && html[0] === '\n'

function decodeAttr (value, shouldDecodeNewlines) {
  const re = shouldDecodeNewlines ? encodedAttrWithNewLines : encodedAttr
  return value.replace(re, match => decodingMap[match])
}

// 解析 HTML 模板
export function parseHTML (html, options) {
  const stack = []
  const expectHTML = options.expectHTML
  const isUnaryTag = options.isUnaryTag || no
  const canBeLeftOpenTag = options.canBeLeftOpenTag || no
  let index = 0 // 当前将要解析的模板字符串的索引
  let last, lastTag
  // 整体流程：维护一个不断前进的索引，表示当前解析到 template 的位置，不断用正则进行匹配，对不同的情况做不同的处理，处理完毕后更新索引，再使用正则进行匹配，直到整个模板被解析完毕
  while (html) {
    last = html
    // Make sure we're not in a plaintext content element like script/style
    if (!lastTag || !isPlainTextElement(lastTag)) {
      let textEnd = html.indexOf('<')
      if (textEnd === 0) {
        // Comment:
        // 匹配注释节点
        if (comment.test(html)) {
          const commentEnd = html.indexOf('-->') // 注释节点的末尾 索引

          if (commentEnd >= 0) {
            if (options.shouldKeepComment) {
              options.comment(html.substring(4, commentEnd), index, index + commentEnd + 3)
            }
            advance(commentEnd + 3) // 将索引前进到注释节点的末尾，`-->` 长度为 3
            continue
          }
        }

        // http://en.wikipedia.org/wiki/Conditional_comment#Downlevel-revealed_conditional_comment
        // 匹配条件注释节点
        if (conditionalComment.test(html)) {
          const conditionalEnd = html.indexOf(']>') // 条件注释节点的末尾 索引

          if (conditionalEnd >= 0) {
            advance(conditionalEnd + 2) // 将索引前进到条件注释节点的末尾，`]>` 长度为 2
            continue
          }
        }

        // Doctype:
        // 匹配文档类型节点
        const doctypeMatch = html.match(doctype)
        if (doctypeMatch) {
          advance(doctypeMatch[0].length) // 将索引前进匹配到的 doctype 的长度
          continue
        }

        // End tag:
        // 匹配闭合标签
        const endTagMatch = html.match(endTag) // 通过正则匹配到闭合标签
        if (endTagMatch) {
          const curIndex = index
          advance(endTagMatch[0].length) // 将索引前进到闭合标签的末尾
          parseEndTag(endTagMatch[1], curIndex, index) // 解析闭合标签，看是否和最近的开始标签匹配
          continue
        }

        // Start tag:
        // 匹配开始标签
        const startTagMatch = parseStartTag() // 解析并拿到开始标签
        if (startTagMatch) {
          handleStartTag(startTagMatch) // 对匹配到的开始标签做处理
          if (shouldIgnoreFirstNewline(startTagMatch.tagName, html)) {
            advance(1)
          }
          continue
        }
      }

      // 匹配文本
      let text, rest, next
      if (textEnd >= 0) { // 如果满足，则当前索引直到末尾都为文本
        rest = html.slice(textEnd)
        while (
          !endTag.test(rest) &&
          !startTagOpen.test(rest) &&
          !comment.test(rest) &&
          !conditionalComment.test(rest)
        ) {
          // < in plain text, be forgiving and treat it as text
          next = rest.indexOf('<', 1) // 如果 < 为纯文本中的字符，就继续找到真正文本结束的位置
          if (next < 0) break
          textEnd += next
          rest = html.slice(textEnd)
        }
        text = html.substring(0, textEnd)
      }

      if (textEnd < 0) { // 说明整个 template 都被解析完毕，将剩余的 html 赋值给 text
        text = html
      }

      if (text) {
        advance(text.length) // 将索引前进文本的长度
      }

      if (options.chars && text) {
        options.chars(text, index - text.length, index)
      }
    } else {
      let endTagLength = 0
      const stackedTag = lastTag.toLowerCase()
      const reStackedTag = reCache[stackedTag] || (reCache[stackedTag] = new RegExp('([\\s\\S]*?)(</' + stackedTag + '[^>]*>)', 'i'))
      const rest = html.replace(reStackedTag, function (all, text, endTag) {
        endTagLength = endTag.length
        if (!isPlainTextElement(stackedTag) && stackedTag !== 'noscript') {
          text = text
            .replace(/<!\--([\s\S]*?)-->/g, '$1') // #7298
            .replace(/<!\[CDATA\[([\s\S]*?)]]>/g, '$1')
        }
        if (shouldIgnoreFirstNewline(stackedTag, text)) {
          text = text.slice(1)
        }
        if (options.chars) {
          options.chars(text)
        }
        return ''
      })
      index += html.length - rest.length
      html = rest
      parseEndTag(stackedTag, index - endTagLength, index)
    }

    if (html === last) {
      options.chars && options.chars(html)
      if (process.env.NODE_ENV !== 'production' && !stack.length && options.warn) {
        options.warn(`Mal-formatted tag at end of template: "${html}"`, { start: index + html.length })
      }
      break
    }
  }

  // Clean up any remaining tags
  parseEndTag()

  // template 解析的匹配过程中，会利用 advance 不断向前推进整个模板字符串
  function advance (n) {
    index += n
    html = html.substring(n)
  }

  // 解析开始标签
  // 除了标签名外，还有一些标签相关的属性需要匹配
  function parseStartTag () {
    const start = html.match(startTagOpen) // 通过正则匹配开始标签
    if (start) {
      const match = {
        tagName: start[1], // 标签名
        attrs: [], // 标签上的属性
        start: index
      }
      advance(start[0].length) // 将索引前进标签名的长度
      let end, attr
      // 循环匹配开始标签的标签属性，直到开始标签的闭合符结束
      while (!(end = html.match(startTagClose)) && (attr = html.match(dynamicArgAttribute) || html.match(attribute))) {
        attr.start = index
        advance(attr[0].length) // 将索引前进匹配的标签属性的长度
        attr.end = index
        match.attrs.push(attr) // 添加到 attrs 中
      }
      if (end) { // 匹配到开始标签闭合符
        match.unarySlash = end[1] // 获取一元斜线符
        advance(end[0].length) // 前进到闭合符末尾
        match.end = index // 当前索引
        return match // 返回解析后的开始标签
      }
    }
  }

  // 对解析后的开始标签做处理
  function handleStartTag (match) {
    const tagName = match.tagName // 标签名
    const unarySlash = match.unarySlash

    if (expectHTML) {
      if (lastTag === 'p' && isNonPhrasingTag(tagName)) {
        parseEndTag(lastTag)
      }
      if (canBeLeftOpenTag(tagName) && lastTag === tagName) {
        parseEndTag(tagName)
      }
    }

    const unary = isUnaryTag(tagName) || !!unarySlash // 判断是否是一元标签，类似 <img> <br>，因为它们不需要闭合标签

    // 遍历并处理开始标签上的属性
    const l = match.attrs.length
    const attrs = new Array(l)
    for (let i = 0; i < l; i++) {
      const args = match.attrs[i]
      const value = args[3] || args[4] || args[5] || ''
      const shouldDecodeNewlines = tagName === 'a' && args[1] === 'href'
        ? options.shouldDecodeNewlinesForHref
        : options.shouldDecodeNewlines
      attrs[i] = {
        name: args[1],
        value: decodeAttr(value, shouldDecodeNewlines)
      }
      if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
        attrs[i].start = args.start + args[0].match(/^\s*/).length
        attrs[i].end = args.end
      }
    }

    // 如果不是一元标签，需要闭合标签
    if (!unary) {
      // 向栈中推入一个对象压栈，后面匹配到闭合标签时需要判断和栈顶标签名是否匹配
      stack.push({ tag: tagName, lowerCasedTag: tagName.toLowerCase(), attrs: attrs, start: match.start, end: match.end })
      lastTag = tagName
    }

    // 执行处理开始标签的回调函数
    if (options.start) {
      options.start(tagName, attrs, unary, match.start, match.end)
    }
  }

  // 解析闭合标签
  function parseEndTag (tagName, start, end) {
    let pos, lowerCasedTagName
    if (start == null) start = index
    if (end == null) end = index

    // Find the closest opened tag of the same type
    if (tagName) {
      lowerCasedTagName = tagName.toLowerCase()
      // 倒序遍历存储了已解析开始标签的栈，找到第一个和当前结束标签匹配的成员
      for (pos = stack.length - 1; pos >= 0; pos--) {
        if (stack[pos].lowerCasedTag === lowerCasedTagName) {
          break
        }
      }
    } else {
      // If no tag name is provided, clean shop
      pos = 0
    }

    if (pos >= 0) {
      // Close all the open elements, up the stack
      for (let i = stack.length - 1; i >= pos; i--) {
        // 结束标签和栈顶的元素不匹配，会报警告，例如 <span></div>
        if (process.env.NODE_ENV !== 'production' &&
          (i > pos || !tagName) &&
          options.warn
        ) {
          options.warn(
            `tag <${stack[i].tag}> has no matching end tag.`,
            { start: stack[i].start, end: stack[i].end }
          )
        }
        if (options.end) {
          options.end(stack[i].tag, start, end)
        }
      }

      // Remove the open elements from the stack
      stack.length = pos // 移出栈内 pos 之后的元素
      lastTag = pos && stack[pos - 1].tag
    } else if (lowerCasedTagName === 'br') {
      if (options.start) {
        options.start(tagName, [], true, start, end)
      }
    } else if (lowerCasedTagName === 'p') {
      if (options.start) {
        options.start(tagName, [], false, start, end)
      }
      if (options.end) {
        options.end(tagName, start, end)
      }
    }
  }
}
