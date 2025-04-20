import { createAsyncThunk } from "@reduxjs/toolkit";
import axios from "axios";

export const login = createAsyncThunk(
  "login",
  async (payload: { email: string; password: string }) => {
    const { email, password } = payload;
    const res = await axios.post("/rest/login", { email, password });
    return res.data;
  },
);
