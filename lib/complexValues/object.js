'use strict'

const constants = require('../constants')
const getObjectKeys = require('../getObjectKeys')
const ObjectFormatter = require('../formatUtils').ObjectFormatter
const hasLength = require('../hasLength')
const recursorUtils = require('../recursorUtils')
const stats = require('../metaDescriptors/stats')

const DEEP_EQUAL = constants.DEEP_EQUAL
const SHALLOW_EQUAL = constants.SHALLOW_EQUAL
const UNEQUAL = constants.UNEQUAL

function describe (props) {
  const isArray = props.stringTag === 'Array'
  const object = props.value
  return new DescribedObjectValue(Object.assign({
    isArray,
    isIterable: object[Symbol.iterator] !== undefined,
    isList: isArray || hasLength(object)
  }, props))
}
exports.describe = describe

function deserialize (state, recursor) {
  return new DeserializedObjectValue(state, recursor)
}
exports.deserialize = deserialize

const tag = Symbol('ObjectValue')
exports.tag = tag

class ObjectValue {
  constructor (props) {
    this.ctor = props.ctor
    this.pointer = props.pointer
    this.stringTag = props.stringTag
    this.unwrapped = props.unwrapped

    this.isArray = props.isArray === true
    this.isIterable = props.isIterable === true
    this.isList = props.isList === true
  }

  compare (expected) {
    if (this.tag !== expected.tag) return UNEQUAL
    if (this.stringTag !== expected.stringTag || this.ctor !== expected.ctor) return UNEQUAL
    if (this.unwrapped && expected.unwrapped && this.unwrapped.compare(expected.unwrapped) !== DEEP_EQUAL) return UNEQUAL
    return SHALLOW_EQUAL
  }

  format (theme, gutter, indent, innerIndent) {
    return new ObjectFormatter(this, theme, gutter, indent, innerIndent)
  }

  serialize () {
    return [this.ctor, this.pointer, this.stringTag, this.unwrapped, this.isArray, this.isIterable, this.isList]
  }
}
Object.defineProperty(ObjectValue.prototype, 'isComplex', { value: true })
Object.defineProperty(ObjectValue.prototype, 'tag', { value: tag })
exports.ObjectValue = ObjectValue

const DescribedObjectValue = DescribedMixin(ObjectValue)
const DeserializedObjectValue = DeserializedMixin(ObjectValue)

function DescribedMixin (base) {
  return class extends base {
    constructor (props) {
      super(props)

      this.value = props.value
      this.describeItem = props.describeItem
      this.describeMapEntry = props.describeMapEntry
      this.describeProperty = props.describeProperty

      this.iterableState = null
      this.listState = null
      this.propertyState = null
    }

    compare (expected) {
      return this.value === expected.value
        ? DEEP_EQUAL
        : super.compare(expected)
    }

    createPropertyRecursor () {
      const objectKeys = getObjectKeys(this.value, this.isList ? this.value.length : 0)
      const size = objectKeys.size
      if (size === 0) return recursorUtils.NOOP_RECURSOR

      let index = 0
      const next = () => {
        if (index === size) return null

        const key = objectKeys.keys[index++]
        return this.describeProperty(key, this.value[key])
      }

      return { size, next }
    }

    createListRecursor () {
      if (!this.isList) return recursorUtils.NOOP_RECURSOR

      const size = this.value.length

      let index = 0
      const next = () => {
        if (index === size) return null

        const current = index
        index++
        return this.describeItem(current, this.value[current])
      }

      return { size, next }
    }

    createIterableRecursor () {
      if (this.isArray || !this.isIterable) return recursorUtils.NOOP_RECURSOR

      const iterator = this.value[Symbol.iterator]()
      let first = iterator.next()

      let done = false
      let size = -1
      if (first.done) {
        if (first.value === undefined) {
          size = 0
          done = true
        } else {
          size = 1
        }
      }

      let index = 0
      const next = () => {
        if (done) return null

        while (!done) {
          const current = first || iterator.next()
          if (current === first) {
            first = null
          }
          if (current.done) {
            done = true
          }

          const item = current.value
          if (done && item === undefined) return null

          if (this.isList && this.value[index] === item) {
            index++
          } else {
            return this.describeItem(index++, item)
          }
        }
      }

      return { size, next }
    }

    createRecursor () {
      let recursedProperty = false
      let recursedList = false
      let recursedIterable = false

      let recursor = null
      return () => {
        let retval = null
        do {
          if (recursor !== null) {
            retval = recursor.next()
            if (retval === null) {
              recursor = null
            }
          }

          while (recursor === null && (!recursedList || !recursedProperty || !recursedIterable)) {
            // Prioritize recursing lists
            if (!recursedList) {
              const replay = recursorUtils.replay(this.listState, () => this.createListRecursor())
              this.listState = replay.state
              recursor = replay.recursor
              recursedList = true
              if (recursor !== recursorUtils.NOOP_RECURSOR) {
                retval = stats.describeListRecursor(recursor)
              }
            } else if (!recursedProperty) {
              const replay = recursorUtils.replay(this.propertyState, () => this.createPropertyRecursor())
              this.propertyState = replay.state
              recursor = replay.recursor
              recursedProperty = true
              if (recursor !== recursorUtils.NOOP_RECURSOR) {
                retval = stats.describePropertyRecursor(recursor)
              }
            } else if (!recursedIterable) {
              const replay = recursorUtils.replay(this.iterableState, () => this.createIterableRecursor())
              this.iterableState = replay.state
              recursor = replay.recursor
              recursedIterable = true
              if (recursor !== recursorUtils.NOOP_RECURSOR) {
                retval = stats.describeIterableRecursor(recursor)
              }
            }
          }
        } while (recursor !== null && retval === null)

        return retval
      }
    }
  }
}
exports.DescribedMixin = DescribedMixin

function DeserializedMixin (base) {
  return class extends base {
    constructor (state, recursor) {
      super({
        ctor: state[0],
        pointer: state[1],
        stringTag: state[2],
        unwrapped: state[3],
        isArray: state[4],
        isIterable: state[5],
        isList: state[6]
      })

      if (recursor) {
        let replayState
        this.createRecursor = () => {
          const replay = recursorUtils.replay(replayState, () => ({ size: -1, next: recursor }))
          replayState = replay.state
          return replay.recursor.next
        }
      } else {
        this.createRecursor = () => () => null
      }
    }
  }
}
exports.DeserializedMixin = DeserializedMixin