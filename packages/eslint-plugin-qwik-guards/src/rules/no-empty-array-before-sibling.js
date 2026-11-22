/**
 * Qwik 2.0.0-rc.4 can remove later siblings when reconciling an empty nested
 * array. Keys on those siblings do not prevent their removal. Keep this rule
 * until a runtime upgrade has passed the typing reproduction in README.md.
 */
// Syntactic guardrail, not whole-program array analysis. Avoid methods such
// as slice/concat that also commonly return strings in JSX.
const arrayMethods = new Set([
  "map",
  "flatMap",
  "filter",
  "flat",
  "toSorted",
  "toReversed",
  "toSpliced",
]);
const preservesLength = new Set(["map", "toSorted", "toReversed"]);

function unwrap(node) {
  while (
    node &&
    [
      "ChainExpression",
      "TSAsExpression",
      "TSTypeAssertion",
      "TSNonNullExpression",
      "TSSatisfiesExpression",
    ].includes(node.type)
  )
    node = node.expression;
  return node;
}

function method(node) {
  const callee = unwrap(node?.callee);
  if (callee?.type !== "MemberExpression") return null;
  const name = callee.computed
    ? callee.property.type === "Literal" && callee.property.value
    : callee.property.name;
  return { name, receiver: unwrap(callee.object) };
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Warn about possibly empty JSX arrays before siblings in Qwik 2.0.0-rc.4",
    },
    schema: [],
    messages: {
      emptyArray:
        "This JSX list can be empty before a later sibling. Qwik 2.0.0-rc.4 can remove and recreate later siblings, losing input focus even with stable keys. Compute the list once and render `list.length > 0 ? list : null`, or isolate it in its own element/component.",
    },
  },
  create(context) {
    const source = context.sourceCode;

    function initializer(node) {
      if (node.type !== "Identifier") return null;
      let scope = source.getScope(node);
      while (scope) {
        const variable = scope.set.get(node.name);
        if (variable) {
          const def = variable.defs[0];
          return def?.type === "Variable" &&
            def.parent.kind === "const" &&
            def.node.id.type === "Identifier"
            ? def.node.init
            : null;
        }
        scope = scope.upper;
      }
      return null;
    }

    function same(a, b) {
      return source.getText(unwrap(a)) === source.getText(unwrap(b));
    }

    // Recognize guards on the result, or on a receiver whose length is
    // preserved. `items.length && items.filter(...)` is deliberately unsafe.
    function lengthSource(node) {
      const call = node.type === "CallExpression" && method(node);
      return call && preservesLength.has(call.name)
        ? lengthSource(call.receiver)
        : node;
    }

    function knownNonempty(node, seen = new Set()) {
      node = unwrap(node);
      if (!node || seen.has(node)) return false;
      seen.add(node);
      if (node.type === "ArrayExpression")
        return node.elements.some(
          (item) => item && item.type !== "SpreadElement",
        );
      const call = node.type === "CallExpression" && method(node);
      return (
        !!call &&
        preservesLength.has(call.name) &&
        knownNonempty(call.receiver, seen)
      );
    }

    function provesNonempty(test, truthy, array) {
      test = unwrap(test);
      if (test.type === "UnaryExpression" && test.operator === "!")
        return provesNonempty(test.argument, !truthy, array);
      if (test.type === "LogicalExpression") {
        if (
          (test.operator === "&&" && truthy) ||
          (test.operator === "||" && !truthy)
        )
          return (
            provesNonempty(test.left, truthy, array) ||
            provesNonempty(test.right, truthy, array)
          );
        return false;
      }
      const isLength = (node) => {
        node = unwrap(node);
        return (
          node.type === "MemberExpression" &&
          !node.computed &&
          node.property.name === "length" &&
          same(node.object, lengthSource(array))
        );
      };
      if (isLength(test)) return truthy;
      if (test.type !== "BinaryExpression" || !isLength(test.left))
        return false;
      const right = unwrap(test.right);
      if (right.type !== "Literal" || typeof right.value !== "number")
        return false;
      if (right.value === 0) {
        if ([">", "!=", "!=="].includes(test.operator)) return truthy;
        if (["===", "==", "<="].includes(test.operator)) return !truthy;
      }
      return test.operator === ">=" && right.value === 1 && truthy;
    }

    function guarded(node, array) {
      for (
        let child = node, parent = node.parent;
        parent;
        child = parent, parent = parent.parent
      ) {
        if (
          parent.type === "ConditionalExpression" &&
          child !== parent.test &&
          provesNonempty(parent.test, child === parent.consequent, array)
        )
          return true;
        if (
          parent.type === "LogicalExpression" &&
          child === parent.right &&
          ["&&", "||"].includes(parent.operator) &&
          provesNonempty(parent.left, parent.operator === "&&", array)
        )
          return true;
        if (
          [
            "ArrowFunctionExpression",
            "FunctionExpression",
            "FunctionDeclaration",
          ].includes(parent.type)
        )
          break;
      }
      return false;
    }

    function possiblyEmpty(node, seen = new Set()) {
      node = unwrap(node);
      if (!node || seen.has(node)) return false;
      seen.add(node);
      if (guarded(node, node)) return false;
      if (node.type === "ArrayExpression")
        return node.elements.every((item) => item?.type === "SpreadElement");
      if (node.type === "CallExpression") {
        const call = method(node);
        if (
          call &&
          preservesLength.has(call.name) &&
          knownNonempty(call.receiver)
        )
          return false;
        return (
          !!call &&
          (arrayMethods.has(call.name) ||
            (call.receiver.type === "Identifier" &&
              call.receiver.name === "Array" &&
              call.name === "from"))
        );
      }
      if (node.type === "Identifier") {
        const init = initializer(node);
        return init ? possiblyEmpty(init, seen) : false;
      }
      if (node.type === "ConditionalExpression")
        return (
          possiblyEmpty(node.consequent, seen) ||
          possiblyEmpty(node.alternate, seen)
        );
      if (node.type === "LogicalExpression")
        return (
          possiblyEmpty(node.left, seen) || possiblyEmpty(node.right, seen)
        );
      return false;
    }

    function meaningfulSibling(node) {
      if (node.type === "JSXText") return node.value.trim().length > 0;
      if (node.type !== "JSXExpressionContainer") return true;
      const expr = unwrap(node.expression);
      return (
        expr.type !== "JSXEmptyExpression" &&
        !(
          expr.type === "Literal" &&
          (expr.value === null || typeof expr.value === "boolean")
        )
      );
    }

    return {
      JSXExpressionContainer(node) {
        const siblings = node.parent.children;
        if (
          !siblings ||
          !siblings.slice(siblings.indexOf(node) + 1).some(meaningfulSibling)
        )
          return;
        if (possiblyEmpty(node.expression))
          context.report({ node, messageId: "emptyArray" });
      },
    };
  },
};
