import type { QRL } from "@qwik.dev/core";

declare module "@qwik.dev/core" {
  /**
   * Qwik 2 removed the PropFunction name while retaining its QRL semantics.
   * Keep Twyne's component prop vocabulary without maintaining a second type.
   */
  export type PropFunction<T> = QRL<T>;
}
