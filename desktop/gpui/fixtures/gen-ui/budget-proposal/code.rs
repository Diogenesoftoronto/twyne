use std::collections::VecDeque;

const WINDOW_MS: f64 = 60_000.0;
const MAX_PER_WINDOW: f64 = 12.0;
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
        let window_wait = if self.calls.len() as f64 >= MAX_PER_WINDOW {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_twelve_calls_a_minute_across_every_caller() {
        let mut budget = SystemOneBudget::new();
        for i in 0..12 {
            let now = 1000.0 + i as f64;
            assert_eq!(budget.wait(now), 0.0);
            budget.spend(now);
        }
        assert_eq!(budget.wait(1012.0), 60_000.0 - 12.0);
        assert_eq!(budget.wait(61_001.0), 0.0);
    }

    #[test]
    fn a_failure_quiets_every_caller_for_thirty_seconds() {
        let mut budget = SystemOneBudget::new();
        budget.back_off(5000.0);
        assert_eq!(budget.wait(5000.0), 30_000.0);
        assert_eq!(budget.wait(35_000.0), 0.0);
    }

    #[test]
    fn window_expiry_is_inclusive_on_the_boundary() {
        let mut budget = SystemOneBudget::new();
        budget.spend(1000.0);
        assert_eq!(budget.wait(60_999.0), 1.0);
        assert_eq!(budget.wait(61_000.0), 0.0);
    }

    #[test]
    fn back_off_overwrites_and_trails_a_moving_clock() {
        let mut budget = SystemOneBudget::new();
        budget.back_off(10_000.0);
        assert_eq!(budget.wait(10_000.0), 30_000.0);
        budget.back_off(5_000.0);
        assert_eq!(budget.wait(5_000.0), 30_000.0);
        assert_eq!(budget.wait(40_000.0), 0.0);
    }

    #[test]
    fn expired_entries_are_pruned_in_insertion_order_without_sorting() {
        let mut budget = SystemOneBudget::new();
        budget.spend(1000.0);
        budget.spend(500.0);
        for i in 0..10 {
            budget.spend(1200.0 + i as f64);
        }
        assert_eq!(budget.wait(61_500.0), 0.0);
        budget.spend(61_500.0);
        assert_eq!(budget.wait(61_500.0), 0.0);
        for i in 0..10 {
            assert_eq!(budget.wait(61_600.0 + i as f64), 0.0);
            budget.spend(61_600.0 + i as f64);
        }
        assert_eq!(budget.wait(61_610.0), 500.0 + 60_000.0 - 61_610.0);
    }

    #[test]
    fn a_clock_moving_backwards_keeps_queue_order_and_blocks_by_earliest_entry() {
        let mut budget = SystemOneBudget::new();
        budget.spend(5_000.0);
        budget.spend(1_000.0);
        assert_eq!(budget.wait(1_000.0), 0.0);
        budget.spend(1_100.0);
        for i in 0..9 {
            budget.spend(1_200.0 + i as f64);
        }
        assert_eq!(budget.wait(1_300.0), 60_000.0 - 1_300.0);
        assert_eq!(budget.wait(61_000.0), 0.0);
    }

    #[test]
    fn reset_clears_spends_and_backoff() {
        let mut budget = SystemOneBudget::new();
        budget.spend(1_000.0);
        budget.back_off(2_000.0);
        budget.reset();
        assert_eq!(budget.wait(1_000.0), 0.0);
        assert_eq!(budget.wait(2_000.0), 0.0);
    }

    #[test]
    fn default_starts_empty_with_zero_backoff() {
        let mut budget = SystemOneBudget::default();
        assert_eq!(budget.wait(0.0), 0.0);
        assert_eq!(budget.wait(123_456.0), 0.0);
    }
}
