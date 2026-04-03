import React from "react";
import ReactDOM from "react-dom/client";
import {
    createHashHistory,
    createRouter,
    RouterProvider
} from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import "./index.css";
import "katex/dist/katex.min.css";

const hashHistory = createHashHistory();
const router = createRouter({ routeTree, history: hashHistory });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <RouterProvider router={router} />
    </React.StrictMode>
);
