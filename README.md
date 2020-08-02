# Vue.js 源码解析

## 介绍

个人对 Vue.js 及周边库源码的学习和解析，并通过给源码添加注释的方式来对学习过程进行记录。

学习过程中配合了黄奕老师的[Vue.js 技术揭秘](https://github.com/ustbhuangyi/vue-analysis)并根据自己的理解来给代码加上中文注释。

你可以通过阅读我的 Commit 信息来了解到我是如何阅读 Vue.js 代码的。

PS：

- 只解读注释 Web 平台浏览器端的相关代码，不对 Weex 和服务器端渲染的代码进行注释
- 一般情况不会对开发环境下的代码做注释，类似以下代码:

```js
if (process.env.NODE_ENV !== 'production') {
  // ...
}
```

## 版本号

- `vue@2.x`: **v2.6.11**

- `vue-router@3.x`: **v3.3.4**

- `vuex@3.x`: **v3.5.1**

## TODO

- [ ] Vue3

- [ ] VueRouter4

- [ ] Vuex4

- [ ] Vite
