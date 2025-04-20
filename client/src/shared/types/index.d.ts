import { State } from "../store";

declare global {
  interface Window {
    DATA: State;
  }
}
