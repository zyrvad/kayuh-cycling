import { Page, TabBar } from "./common.tsx";

export function Home() {
  return (
    <>
      <Page title="Home">
        <p class="muted">Your rides and routes will gather here.</p>
      </Page>
      <TabBar />
    </>
  );
}
