import { initMixin } from './init'
import { stateMixin } from './state'
import { renderMixin } from './render'
import { eventsMixin } from './events'
import { lifecycleMixin } from './lifecycle'
import { warn } from '../util/index'

// Vue 构造函数，我们使用的 new Vue() 就是它
function Vue (options) {
  // 非生产环境下报警告，只能作为构造函数来使用，不能作为方法来调用
  if (process.env.NODE_ENV !== 'production' &&
    !(this instanceof Vue)
  ) {
    warn('Vue is a constructor and should be called with the `new` keyword')
  }
  this._init(options)
}

// 在 Vue 的原型上做扩展，如果通过 Class 来声明 Vue 这个类，就不太好处理这部分扩展
// 使用不同的模块来扩展 Vue，让代码更易于维护和管理
initMixin(Vue)
stateMixin(Vue)
eventsMixin(Vue)
lifecycleMixin(Vue)
renderMixin(Vue)

export default Vue
