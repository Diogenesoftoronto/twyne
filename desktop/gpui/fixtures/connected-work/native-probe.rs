//! Executed only against the synthetic loopback fixture, never a real account.
use anyhow::{Context, Result, ensure};
use serde::Deserialize;
use serde_json::json;
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};
use twyne_desktop::native_accounts::{
    auth::{CallbackRegistration, SignInAttempt},
    callback::CallbackListener,
    knowledge_wire::SourceCatalogResponse,
    protocol::PullSnapshot,
    transport::{ConnectedHelper, ConnectedProfile, CredentialStorage, TransportError},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    helper: PathBuf,
    site_url: String,
    convex_url: String,
    callback_origin: String,
    tool_dispatched: PathBuf,
    callback_ready: PathBuf,
    output: PathBuf,
}
fn run() -> Result<()> {
    let path = std::env::args_os()
        .nth(1)
        .context("A loopback fixture configuration is required")?;
    let fixture: Fixture = serde_json::from_slice(&std::fs::read(path)?)?;
    for origin in [&fixture.site_url, &fixture.convex_url] {
        let url = url::Url::parse(origin)?;
        ensure!(
            url.scheme() == "http" && url.host_str() == Some("127.0.0.1"),
            "This probe supports only its synthetic loopback backend"
        );
    }
    let profile = ConnectedProfile {
        registration: CallbackRegistration {
            origin: fixture.callback_origin.clone(),
            twyne_backend_trusted: true,
            gateway_product: Some("twyne".into()),
        },
        site_url: fixture.site_url,
        convex_url: fixture.convex_url,
    };
    let listener = CallbackListener::bind(&profile.registration)?;
    let mut attempt = SignInAttempt::prepare(&profile.registration, [1; 32], [2; 32], 100, "/")?;
    let helper = ConnectedHelper::start(&fixture.helper, profile, CredentialStorage::SessionOnly)?;
    ensure!(
        helper.restore()?.is_none(),
        "A fixture cannot restore a real account"
    );
    std::fs::write(
        &fixture.callback_ready,
        serde_json::to_vec(&json!({
            "origin":listener.origin(), "state":attempt.state(), "synthetic":true,
        }))?,
    )?;
    let deadline = Instant::now() + Duration::from_secs(10);
    let input = loop {
        if let Some(input) = listener.poll(attempt.state())? {
            break input;
        }
        ensure!(
            Instant::now() < deadline,
            "The synthetic browser callback did not arrive"
        );
        std::thread::sleep(Duration::from_millis(5));
    };
    let request = attempt.consume_callback(&input, 101)?;
    let accepted = helper.redeem(request)?;
    let snapshot: PullSnapshot =
        serde_json::from_value(helper.request(accepted.lease(), "sync.pull", json!({}))?)?;
    snapshot.validate()?;
    ensure!(
        snapshot.sync_revision == 7 && snapshot.payload.folios.len() == 1,
        "The fixture snapshot did not round-trip"
    );
    ensure!(
        helper.request(accepted.lease(), "sync.push", json!({"expectedRevision":6}))
            == Err(TransportError::SyncConflict),
        "A rejected Source revision was incorrectly treated as an unknown write outcome"
    );
    let catalog: SourceCatalogResponse = serde_json::from_value(helper.request(
        accepted.lease(),
        "knowledge.sources",
        json!({}),
    )?)?;
    ensure!(
        catalog.data.len() == 1
            && catalog.data[0].tools.len() == 1
            && catalog.data[0].tools[0].name == "search"
            && catalog.data[0].tools[0].extra.get("title") == Some(&json!(5))
            && catalog.data[0].tools[0].extra.get("description") == Some(&serde_json::Value::Null),
        "The Source-admitted knowledge catalog did not round-trip"
    );
    let worker = helper.clone();
    let lease = accepted.lease().clone();
    let pending = std::thread::spawn(move || {
        worker.request(
            &lease,
            "knowledge.call",
            json!({
                "sourceId":"fixture-source", "tool":"search", "arguments":{"query":"fixture"},
            }),
        )
    });
    let deadline = Instant::now() + Duration::from_secs(5);
    while !fixture.tool_dispatched.is_file() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(5));
    }
    ensure!(
        fixture.tool_dispatched.is_file(),
        "The fixture tool request did not arrive"
    );
    helper.sign_out()?;
    let result = pending
        .join()
        .map_err(|_| anyhow::anyhow!("The fixture worker stopped"))?;
    ensure!(
        result == Err(TransportError::UnknownOutcome),
        "An in-flight external call was incorrectly acknowledged after sign-out"
    );
    ensure!(
        helper.request(accepted.lease(), "sync.pull", json!({})) == Err(TransportError::SignedOut),
        "A signed-out lease remained usable"
    );
    helper.stop();
    std::fs::write(
        fixture.output,
        serde_json::to_vec_pretty(&json!({
            "status":"passed", "scope":"Rust IPC and real SDK HTTP against a synthetic loopback backend; no production or account proof",
            "authenticatedReceipt":true, "sourcePullDtoValidated":true,
            "nativeLoopbackCallbackConsumed":true,
            "sourceRevisionConflictPreserved":true,
            "nativeKnowledgeCatalogValidated":true,
            "unknownToolOutcomeOnSignOut":true, "signedOutLeaseRejected":true,
            "userLibraryTouched":false, "realCredentialsUsed":false,
        }))?,
    )?;
    println!("Connected SDK loopback probe passed.");
    Ok(())
}
fn main() {
    if run().is_err() {
        eprintln!("The connected loopback probe failed; no private protocol data is printed.");
        std::process::exit(1);
    }
}
