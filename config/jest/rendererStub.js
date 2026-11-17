/**
 * Stands in for a renderer module jest's resolver cannot reach (a package subpath without an
 * `exports` entry). Tests walk the content tree as data and never render it, so nothing here is
 * ever called — every export is a proxy that tolerates being read, called or constructed.
 *
 * The server does the same thing for its bundle, for the same reason (server/build.mjs).
 */
const make = () =>
  new Proxy(function () {}, {
    get: (target, key) =>
      key === Symbol.toPrimitive ? () => 0 : key === "then" ? undefined : key === "prototype" ? target.prototype : make(),
    set: () => true,
    has: () => true,
    apply: () => make(),
    construct: () => make(),
  });

module.exports = make();
