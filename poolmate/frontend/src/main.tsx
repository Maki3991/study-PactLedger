import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { consumeConfirmationTokenFromLocation } from "./orders/confirmationToken";
import "./styles.css";

const confirmationToken = consumeConfirmationTokenFromLocation();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App confirmationToken={confirmationToken} />
  </StrictMode>
);
