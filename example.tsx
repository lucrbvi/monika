import { Activity, Suspense, use, useState } from "react";
import { renderCLI, useInput, useTerminal } from "./src/index";

const TABS = ["Overview", "Suspense", "Counter"] as const;

const quotePromise = new Promise<string>((resolve) =>
  setTimeout(() => resolve("The terminal is mightier than the GUI."), 1500),
);

function Quote() {
  const quote = use(quotePromise);
  return <blockquote>{quote}</blockquote>;
}

function Counter() {
  const [count, setCount] = useState(0);

  useInput(({ name }) => {
    if (name === "=") {
      setCount((c) => c + 1);
    }
  });

  return (
    <p>
      Count: <strong>{count}</strong>
      {" — press "}
      <code>=</code>
      {" to increment"}
    </p>
  );
}

function App() {
  const { columns } = useTerminal();
  const [tab, setTab] = useState(0);

  useInput(({ ctrl, name }) => {
    if (ctrl && name === "c") process.exit(0);
    if (name === "left" && tab > 0) setTab(tab - 1);
    if (name === "right" && tab < TABS.length - 1) setTab(tab + 1);
  });

  const tabBar = TABS.map((t, i) =>
    i === tab ? `[${t}]` : ` ${t} `,
  ).join(" | ");

  return (
    <div>
      <h1>monika</h1>
      <p>{tabBar}</p>
      <hr />

      <Activity mode={tab === 0 ? "visible" : "hidden"}>
        <div>
          <p>
            Terminal width: <strong>{columns}</strong> columns
          </p>
          <h2>
            This a really <b>bold</b> heading
          </h2>
          <p>
            I am an <i>italic</i> paragraph with a{" "}
            <a href="https://github.com">link</a>.
          </p>
        </div>
      </Activity>

      <Activity mode={tab === 1 ? "visible" : "hidden"}>
        <div>
          <h2>Suspense + use()</h2>
          <Suspense fallback={<p><em>Loading quote...</em></p>}>
            <Quote />
          </Suspense>
          <p>
            {"Data fetched via a promise, read with "}
            <code>use()</code>.
          </p>
        </div>
      </Activity>

      <Activity mode={tab === 2 ? "visible" : "hidden"}>
        <div>
          <h2>Counter</h2>
          <Counter />
        </div>
      </Activity>

      <p>
        {"Use "}
        <strong>{"<- ->"}</strong>
        {" to switch tabs. State is preserved via Activity."}
      </p>
    </div>
  );
}

renderCLI(<App />);
