/// <reference types="vite/client" />
import type { JSX as ReactJSX } from "react";

declare global {
  namespace JSX {
    type Element = ReactJSX.Element;
    interface IntrinsicElements extends ReactJSX.IntrinsicElements {}
  }
}

declare module "*?inline" {
  const css: string;
  export default css;
}

export {};
