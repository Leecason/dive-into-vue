import Module from './module'
import { assert, forEachValue } from '../util'

// module 收集器
export default class ModuleCollection {
  constructor (rawRootModule) {
    // register root module (Vuex.Store options)
    this.register([], rawRootModule, false) // 注册根 module
  }

  // 根据 path 获取对应的 module
  get (path) {
    return path.reduce((module, key) => {
      return module.getChild(key)
    }, this.root)
  }

  // 获取 namespace，当 namespaced 为 true 的时候会返回 'moduleName/name'
  // 默认情况下，模块内部的 action、mutation 和 getter 是注册在全局命名空间的
  // 这样使得多个模块能够对同一 mutation 或 action 作出响应
  // 如果希望你的模块具有更高的封装度和复用性，你可以通过添加 namespaced: true 的方式使其成为命名空间模块
  // 当模块被注册后，它的所有 getter、action 及 mutation 都会自动根据模块注册的路径调整命名
  getNamespace (path) {
    let module = this.root
    return path.reduce((namespace, key) => {
      module = module.getChild(key)
      return namespace + (module.namespaced ? key + '/' : '')
    }, '')
  }

  update (rawRootModule) {
    update([], this.root, rawRootModule)
  }

  register (path /* module 路径*/, rawModule /* module 定义 */, runtime = true /* 动态注册 */) {
    if (__DEV__) {
      assertRawModule(path, rawModule)
    }

    const newModule = new Module(rawModule, runtime) // 实例一个 module
    if (path.length === 0) { // 根 module
      this.root = newModule
    } else {
      // 建立 module 父子关系
      const parent = this.get(path.slice(0, -1)) // 获取父级 module
      parent.addChild(path[path.length - 1], newModule) // 向父 module 中添加子 module
    }

    // register nested modules
    // 递归注册 module
    if (rawModule.modules) {
      forEachValue(rawModule.modules, (rawChildModule, key) => {
        this.register(path.concat(key) /* 拼接 path */, rawChildModule, runtime)
      })
    }
  }

  unregister (path) {
    const parent = this.get(path.slice(0, -1))
    const key = path[path.length - 1]
    const child = parent.getChild(key)

    if (!child) {
      if (__DEV__) {
        console.warn(
          `[vuex] trying to unregister module '${key}', which is ` +
          `not registered`
        )
      }
      return
    }

    if (!child.runtime) {
      return
    }

    parent.removeChild(key)
  }

  isRegistered (path) {
    const parent = this.get(path.slice(0, -1))
    const key = path[path.length - 1]

    return parent.hasChild(key)
  }
}

function update (path, targetModule, newModule) {
  if (__DEV__) {
    assertRawModule(path, newModule)
  }

  // update target module
  targetModule.update(newModule)

  // update nested modules
  if (newModule.modules) {
    for (const key in newModule.modules) {
      if (!targetModule.getChild(key)) {
        if (__DEV__) {
          console.warn(
            `[vuex] trying to add a new module '${key}' on hot reloading, ` +
            'manual reload is needed'
          )
        }
        return
      }
      update(
        path.concat(key),
        targetModule.getChild(key),
        newModule.modules[key]
      )
    }
  }
}

const functionAssert = {
  assert: value => typeof value === 'function',
  expected: 'function'
}

const objectAssert = {
  assert: value => typeof value === 'function' ||
    (typeof value === 'object' && typeof value.handler === 'function'),
  expected: 'function or object with "handler" function'
}

const assertTypes = {
  getters: functionAssert,
  mutations: functionAssert,
  actions: objectAssert
}

function assertRawModule (path, rawModule) {
  Object.keys(assertTypes).forEach(key => {
    if (!rawModule[key]) return

    const assertOptions = assertTypes[key]

    forEachValue(rawModule[key], (value, type) => {
      assert(
        assertOptions.assert(value),
        makeAssertionMessage(path, key, type, value, assertOptions.expected)
      )
    })
  })
}

function makeAssertionMessage (path, key, type, value, expected) {
  let buf = `${key} should be ${expected} but "${key}.${type}"`
  if (path.length > 0) {
    buf += ` in module "${path.join('.')}"`
  }
  buf += ` is ${JSON.stringify(value)}.`
  return buf
}
