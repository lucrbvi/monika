import { Activity, Suspense, use, useState } from "react";
import { renderCLI, useClick, useInput } from "./src/index";

const TABS = ["Overview", "Suspense", "Counter"] as const;

const quotePromise = new Promise<string>((resolve) =>
  setTimeout(() => resolve("The terminal is mightier than the GUI."), 3000),
);

function Quote() {
  const quote = use(quotePromise);
  return <blockquote>{quote}</blockquote>;
}

function Counter() {
  const [count, setCount] = useState(0);

  useInput(({ name }) => {
    if (name === "-") setCount((c) => c - 1);
    if (name === "+" || name === "=") setCount((c) => c + 1);
  });

  return (
    <div>
      <p>
        <span onClick={() => setCount((c) => c - 1)}>{"[-]"}</span>
        {"  " + count + "  "}
        <span onClick={() => setCount((c) => c + 1)}>{"[+]"}</span>
      </p>
      <p>
        {"Click the buttons or press "}
        <code>-</code>
        {" / "}
        <code>+</code>
      </p>
    </div>
  );
}

function App() {
  const [tab, setTab] = useState(0);

  useClick();

  useInput(({ ctrl, name }) => {
    if (ctrl && name === "c") process.exit(0);
    if (name === "left") setTab((t) => Math.max(0, t - 1));
    if (name === "right") setTab((t) => Math.min(TABS.length - 1, t + 1));
  });

  return (
    <div>
      <h1>monika</h1>
      <p>
        {TABS.map((t, i) => (
          <span key={t}>
            {i > 0 ? " | " : ""}
            <span onClick={() => setTab(i)}>{i === tab ? `[${t}]` : ` ${t} `}</span>
          </span>
        ))}
      </p>
      <hr />

      <Activity mode={tab === 0 ? "visible" : "hidden"}>
        <div>
          <h2>
            This a really <b>bold</b> heading
          </h2>
          <p>
            I am an <i>italic</i> paragraph with a <a href="https://github.com">link</a>.
          </p>
        </div>
      </Activity>

      <Activity mode={tab === 1 ? "visible" : "hidden"}>
        <div>
          <h2>Suspense + use()</h2>
          <Suspense
            fallback={
              <p>
                <em>Loading quote...</em>
              </p>
            }
          >
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
        {" or click tabs. State is preserved via Activity."}
      </p>
    </div>
  );
}

renderCLI(<App />);
