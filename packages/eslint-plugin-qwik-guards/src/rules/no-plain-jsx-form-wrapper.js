/**
 * Twyne's brief lost input identity during asynchronous strength updates when
 * a hook-free DossierFolio function was used as <DossierFolio leaf={...} />.
 * See historical commit 633726a23d137ee3ef666d0c831706147557b9a2 (Qwik beta.42).
 * Restrict this warning to editable subtrees so plain icon helpers stay quiet.
 */
function unwrap(node) {
  while (
    node &&
    [
      "TSAsExpression",
      "TSSatisfiesExpression",
      "TSNonNullExpression",
      "ChainExpression",
    ].includes(node.type)
  )
    node = node.expression;
  return node;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Warn about plain-function JSX wrappers around editable Qwik subtrees",
    },
    schema: [],
    messages: {
      plainWrapper:
        "{{name}} is a plain function used as a JSX wrapper around editable content. This pattern caused input remounts during Qwik 2 beta.42 parent updates. Invoke a hook-free layout renderer directly, or use a stable component$ boundary and verify projection/reactivity. Check DOM identity, focus, and caret after async updates.",
    },
  },
  create(context) {
    const source = context.sourceCode;
    const services = source.parserServices;

    function definition(node, seen = new Set()) {
      node = unwrap(node);
      if (
        !node ||
        (node.type !== "JSXIdentifier" && node.type !== "Identifier")
      )
        return null;
      let scope = source.getScope(node);
      while (scope) {
        const variable = scope.set.get(node.name);
        if (variable) {
          if (seen.has(variable)) return null;
          seen.add(variable);
          const def = variable.defs[0];
          if (def?.type === "FunctionName") return def.node;
          if (def?.type === "Variable" && def.node.id.type === "Identifier") {
            const init = unwrap(def.node.init);
            if (init?.type === "Identifier") return definition(init, seen);
            if (
              ["ArrowFunctionExpression", "FunctionExpression"].includes(
                init?.type,
              )
            )
              return init;
          }
          return null;
        }
        scope = scope.upper;
      }
      return null;
    }

    function editable(node) {
      if (!node) return false;
      if (node.type === "JSXOpeningElement") {
        const tag = node.name.type === "JSXIdentifier" && node.name.name;
        if (["input", "textarea", "select"].includes(tag)) return true;
        if (
          node.attributes.some(
            (a) =>
              a.type === "JSXAttribute" &&
              ["contentEditable", "contenteditable"].includes(a.name.name) &&
              !(a.value?.type === "Literal" && a.value.value === "false") &&
              !(
                a.value?.type === "JSXExpressionContainer" &&
                a.value.expression.value === false
              ),
          )
        )
          return true;
      }
      return (source.visitorKeys[node.type] ?? []).some((key) => {
        const child = node[key];
        return Array.isArray(child) ? child.some(editable) : editable(child);
      });
    }

    function typedDefinition(name) {
      if (!services?.program || !services.esTreeNodeToTSNodeMap) return null;
      const tsName = services.esTreeNodeToTSNodeMap.get(name);
      if (!tsName) return null;
      const checker = services.program.getTypeChecker();
      const signatures = checker.getTypeAtLocation(tsName).getCallSignatures();
      // component$ call signatures come from declaration types without a
      // function body; plain source functions have a concrete body here.
      return (
        signatures
          .map((signature) => signature.getDeclaration())
          .find(
            (declaration) =>
              declaration?.body &&
              !declaration.getSourceFile().isDeclarationFile,
          ) ?? null
      );
    }

    function typedEditable(node) {
      if (!node) return false;
      const tag = node.tagName?.getText();
      if (["input", "textarea", "select"].includes(tag)) return true;
      if (
        node.tagName &&
        node.attributes?.properties?.some(
          (a) =>
            ["contentEditable", "contenteditable"].includes(
              a.name?.getText(),
            ) &&
            !["false", '"false"', "'false'", "{false}"].includes(
              a.initializer?.getText(),
            ),
        )
      )
        return true;
      let found = false;
      node.forEachChild((child) => {
        if (!found && typedEditable(child)) found = true;
      });
      return found;
    }

    return {
      JSXElement(node) {
        const name = node.openingElement.name;
        if (name.type === "JSXIdentifier" && !/^[A-Z]/.test(name.name)) return;
        const local = definition(name);
        const typed = local ? null : typedDefinition(name);
        if (!local && !typed) return;
        if (
          !editable(node) &&
          !(local ? editable(local.body) : typedEditable(typed.body))
        )
          return;
        context.report({
          node: node.openingElement,
          messageId: "plainWrapper",
          data: { name: source.getText(name) },
        });
      },
    };
  },
};
