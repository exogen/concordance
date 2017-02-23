'use strict'

const hop = Object.prototype.hasOwnProperty

module.exports = (tag, value) => {
  if (value.constructor === undefined) {
    if (tag !== 'Object' || value instanceof Object) return null

    // Values without a constructor, that do not inherit from `Object`, but are
    // tagged as objects, may come from `Object.create(null)`. Or they can come
    // from a different realm, e.g.:
    //
    // ```
    // require('vm').runInNewContext(`
    //   const Foo = function () {}
    //   Foo.prototype.constructor = undefined
    //   return new Foo()
    // `)
    // ```
    //
    // Treat such objects as if they came from `Object.create(null)` (in the
    // current realm) only if they do not have inherited properties. This allows
    // these objects to be compared with object literals.
    //
    // This means `Object.create(null)` is not differentiated from `{}`.
    for (const p in value) {
      if (!hop.call(value, p)) return null
    }
    return tag
  }

  if (!value.constructor) return null

  const name = value.constructor.name
  return typeof name === 'string' && name !== ''
    ? name
    : null
}