use std::sync::Arc;

const LOWER16: u64 = 0xffff;
const FACTOR16: u64 = 1 << 16;

const DEL_BEFORE: u32 = 1;
const DEL_AFTER: u32 = 2;
const DEL_ACROSS: u32 = 4;
const DEL_SIDE: u32 = 8;

/// Encode a range ordinal (lower 16 bits) plus an offset into one token.
/// Exact only when `index < 2^16` and `index + offset * 65536 <= 2^53 - 1`
/// (the JavaScript safe-integer limit where `makeRecover` is itself exact).
#[inline]
fn make_recover(index: usize, offset: usize) -> u64 {
    debug_assert!((index as u64) < FACTOR16);
    index as u64 + offset as u64 * FACTOR16
}

#[inline]
fn recover_index(value: u64) -> usize {
    (value & LOWER16) as usize
}

#[inline]
fn recover_offset(value: u64) -> u64 {
    (value - (value & LOWER16)) / FACTOR16
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MapResult {
    pub pos: usize,
    pub del_info: u32,
    pub recover: Option<u64>,
}

impl MapResult {
    pub fn new(pos: usize, del_info: u32, recover: Option<u64>) -> Self {
        MapResult { pos, del_info, recover }
    }

    pub fn deleted(&self) -> bool {
        (self.del_info & DEL_SIDE) > 0
    }

    pub fn deleted_before(&self) -> bool {
        (self.del_info & (DEL_BEFORE | DEL_ACROSS)) > 0
    }

    pub fn deleted_after(&self) -> bool {
        (self.del_info & (DEL_AFTER | DEL_ACROSS)) > 0
    }

    pub fn deleted_across(&self) -> bool {
        (self.del_info & DEL_ACROSS) > 0
    }
}

#[derive(Debug, Clone)]
pub struct StepMap {
    pub ranges: Arc<[[usize; 3]]>,
    pub inverted: bool,
}

impl StepMap {
    pub fn new(ranges: Vec<[usize; 3]>) -> Self {
        if ranges.is_empty() {
            return StepMap::empty();
        }
        StepMap { ranges: Arc::from(ranges), inverted: false }
    }

    pub fn empty() -> Self {
        StepMap { ranges: Arc::from(Vec::new()), inverted: false }
    }

    pub fn is_empty(&self) -> bool {
        self.ranges.is_empty()
    }

    pub fn invert(&self) -> StepMap {
        StepMap { ranges: Arc::clone(&self.ranges), inverted: !self.inverted }
    }

    pub fn offset(n: i64) -> StepMap {
        if n == 0 {
            StepMap::empty()
        } else if n < 0 {
            StepMap::new(vec![[0, (-n) as usize, 0]])
        } else {
            StepMap::new(vec![[0, 0, n as usize]])
        }
    }

    pub fn recover(&self, token: u64) -> usize {
        let index = recover_index(token);
        let mut diff: i64 = 0;
        if !self.inverted {
            let mut j = 0;
            while j < index {
                diff += self.ranges[j][2] as i64 - self.ranges[j][1] as i64;
                j += 1;
            }
        }
        (self.ranges[index][0] as i64 + diff + recover_offset(token) as i64) as usize
    }

    pub fn map(&self, pos: usize, assoc: i32) -> usize {
        self.map_result(pos, assoc).pos
    }

    pub fn map_result(&self, pos: usize, assoc: i32) -> MapResult {
        let pos_i = pos as i64;
        let assoc_i = assoc as i64;
        let assoc_neg = assoc < 0;
        let old_index: usize = if self.inverted { 2 } else { 1 };
        let new_index: usize = if self.inverted { 1 } else { 2 };
        let mut diff: i64 = 0;
        let len = self.ranges.len();
        let mut r: usize = 0;
        while r < len {
            let range = &self.ranges[r];
            let start = range[0] as i64 - (if self.inverted { diff } else { 0 });
            if start > pos_i {
                break;
            }
            let old_size = range[old_index] as i64;
            let new_size = range[new_index] as i64;
            let end = start + old_size;
            if pos_i <= end {
                let side = if old_size == 0 {
                    assoc_i
                } else if pos_i == start {
                    -1
                } else if pos_i == end {
                    1
                } else {
                    assoc_i
                };
                let result = start + diff + (if side < 0 { 0 } else { new_size });
                let boundary = if assoc_neg { start } else { end };
                let recover = if pos_i == boundary {
                    None
                } else {
                    Some(make_recover(r, (pos_i - start) as usize))
                };
                let mut del = if pos_i == start {
                    DEL_AFTER
                } else if pos_i == end {
                    DEL_BEFORE
                } else {
                    DEL_ACROSS
                };
                let off_side = if assoc_neg { pos_i != start } else { pos_i != end };
                if off_side {
                    del |= DEL_SIDE;
                }
                return MapResult { pos: result as usize, del_info: del, recover };
            }
            diff += new_size - old_size;
            r += 1;
        }
        MapResult { pos: (pos_i + diff) as usize, del_info: 0, recover: None }
    }

    pub fn touches(&self, pos: usize, token: u64) -> bool {
        let pos_i = pos as i64;
        let index = recover_index(token);
        let old_index: usize = if self.inverted { 2 } else { 1 };
        let new_index: usize = if self.inverted { 1 } else { 2 };
        let mut diff: i64 = 0;
        let len = self.ranges.len();
        let mut r: usize = 0;
        while r < len {
            let range = &self.ranges[r];
            let start = range[0] as i64 - (if self.inverted { diff } else { 0 });
            if start > pos_i {
                break;
            }
            let old_size = range[old_index] as i64;
            let end = start + old_size;
            if pos_i <= end && r == index {
                return true;
            }
            diff += range[new_index] as i64 - old_size;
            r += 1;
        }
        false
    }

    pub fn changed_ranges(&self) -> Vec<[usize; 4]> {
        let old_index: usize = if self.inverted { 2 } else { 1 };
        let new_index: usize = if self.inverted { 1 } else { 2 };
        let len = self.ranges.len();
        let mut out: Vec<[usize; 4]> = Vec::with_capacity(len);
        let mut diff: i64 = 0;
        let mut r: usize = 0;
        while r < len {
            let range = &self.ranges[r];
            let start = range[0] as i64;
            let old_start = start - (if self.inverted { diff } else { 0 });
            let new_start = start + (if self.inverted { 0 } else { diff });
            let old_size = range[old_index] as i64;
            let new_size = range[new_index] as i64;
            out.push([
                old_start as usize,
                (old_start + old_size) as usize,
                new_start as usize,
                (new_start + new_size) as usize,
            ]);
            diff += new_size - old_size;
            r += 1;
        }
        out
    }
}
