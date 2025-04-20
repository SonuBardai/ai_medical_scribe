import { createSlice } from "@reduxjs/toolkit";
import { login } from "./thunk";

type User = {
  id: string;
};

type UserStateType = {
  user: User | null;
};

const initialState: UserStateType = {
  user: null,
};

const userSlice = createSlice({
  name: "userState",
  initialState,
  reducers: {
    setUser: (state, action) => {
      state.user = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(login.fulfilled, (state, action) => {
      state.user = action.payload;
    });
  },
});

export const { setUser } = userSlice.actions;
export default userSlice.reducer;
