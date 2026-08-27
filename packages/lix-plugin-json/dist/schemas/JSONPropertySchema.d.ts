export declare const JSONPropertySchema: {
  readonly key: "lix_plugin_json_property";
  readonly type: "json";
  readonly schema: {
    readonly type: "object";
    readonly properties: {
      readonly property: {
        readonly type: "string";
      };
    };
    readonly required: readonly ["property"];
    readonly additionalProperties: true;
  };
};
