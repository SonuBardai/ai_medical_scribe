import { configureStore } from "@reduxjs/toolkit";
import { TypedUseSelectorHook, useDispatch, useSelector } from "react-redux";
import userReducer from "./reducers/user/reducer";
import { windowDataMiddleware } from "./middleware";

const store = configureStore({
  reducer: {
    user: userReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(windowDataMiddleware),
});

export default store;
export type State = ReturnType<typeof store.getState>;
export const useStateDispatch: () => typeof store.dispatch = useDispatch;
export const useStateSelector: TypedUseSelectorHook<State> = useSelector;
