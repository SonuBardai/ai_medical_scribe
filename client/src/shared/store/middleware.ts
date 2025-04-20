import { Middleware } from "@reduxjs/toolkit";
import { State } from ".";

const setData = (state: State) => {
  window.DATA = {
    ...(window.DATA || {}),
    ...state,
  };
};

export const windowDataMiddleware: Middleware =
  (store) => (next) => (action) => {
    const result = next(action);
    setData(store.getState());
    return result;
  };
