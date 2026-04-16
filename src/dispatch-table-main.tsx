import ReactDOM from "react-dom/client";
import DispatchTable from "./components/DispatchTable";
import "./App.css";

function DispatchTableApp() {
  return (
    <div style={{ width: "100%", height: "100%", padding: "16px" }}>
      <DispatchTable />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <DispatchTableApp />,
);

window.addEventListener("beforeunload", () => {
  const config = {
    width: window.outerWidth,
    height: window.outerHeight,
    left: window.screenX,
    top: window.screenY,
  };
  localStorage.setItem("dispatchTableWindowConfig", JSON.stringify(config));
});
