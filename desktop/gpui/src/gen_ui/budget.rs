//! Shared request budget for every native pause-driven System One caller.
use std::collections::VecDeque;

const WINDOW_MS: f64 = 60_000.0;
const MAX_PER_WINDOW: usize = 12;
const BACKOFF_MS: f64 = 30_000.0;

#[derive(Debug, Default, Clone)]
pub struct SystemOneBudget {
    calls: VecDeque<f64>,
    backoff_until: f64,
}

impl SystemOneBudget {
    pub fn new() -> Self {
        Self {
            calls: VecDeque::new(),
            backoff_until: 0.0,
        }
    }

    /// Milliseconds to wait before a call is allowed; 0 means go now.
    pub fn wait(&mut self, now: f64) -> f64 {
        while let Some(&first) = self.calls.front() {
            if first <= now - WINDOW_MS {
                self.calls.pop_front();
            } else {
                break;
            }
        }
        let window_wait = if self.calls.len() >= MAX_PER_WINDOW {
            self.calls.front().copied().unwrap_or(now) + WINDOW_MS - now
        } else {
            0.0
        };
        (self.backoff_until - now).max(window_wait).max(0.0)
    }

    /// Record a call that is about to be made.
    pub fn spend(&mut self, now: f64) {
        self.calls.push_back(now);
    }

    /// A failed call quiets every pause-driven caller for a while.
    pub fn back_off(&mut self, now: f64) {
        self.backoff_until = now + BACKOFF_MS;
    }

    pub fn reset(&mut self) {
        self.calls.clear();
        self.backoff_until = 0.0;
    }
}
