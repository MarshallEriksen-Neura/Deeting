use std::sync::Arc;

use crate::modules::memory::service::MemoryService;

/// Run a background embedding backfill for memories that have no embedding.
///
/// This is a fire-and-forget task spawned at startup. It:
/// - Queries for memories with `embedding IS NULL`
/// - Embeds each one via `EmbeddingService`
/// - Updates the row with the new embedding
/// - Rate-limits to avoid overwhelming the embedding API
/// - Individual item failures do not stop the backfill
/// - The NULL query is the progress tracker (idempotent/resumable)
pub async fn run_embedding_backfill(service: Arc<MemoryService>) {
    const BATCH_SIZE: usize = 50;
    const DELAY_BETWEEN_ITEMS: std::time::Duration = std::time::Duration::from_millis(100);

    log::info!("memory backfill: starting embedding backfill");

    let mut total_processed = 0u64;
    let mut total_failed = 0u64;

    loop {
        let items = match service
            .store()
            .list_memories_without_embedding(BATCH_SIZE)
            .await
        {
            Ok(items) => items,
            Err(e) => {
                log::warn!(
                    "memory backfill: failed to query unembedded memories: {}",
                    e
                );
                break;
            }
        };

        if items.is_empty() {
            break;
        }

        for item in &items {
            match service.embed_and_update(&item.id, &item.content).await {
                Ok(true) => {
                    total_processed += 1;
                }
                Ok(false) => {
                    // Item was deleted or not found — skip silently
                }
                Err(e) => {
                    total_failed += 1;
                    log::warn!("memory backfill: failed to embed memory {}: {}", item.id, e);
                }
            }
            tokio::time::sleep(DELAY_BETWEEN_ITEMS).await;
        }
    }

    log::info!(
        "memory backfill: completed. processed={}, failed={}",
        total_processed,
        total_failed
    );
}
