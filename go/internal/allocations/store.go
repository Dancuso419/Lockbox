// Package allocations holds prize-pool allocation tables in TEE memory only.
// Nothing here is ever persisted or logged in cleartext.
package allocations

import (
	"fmt"
	"math/big"
	"sync"

	"github.com/ethereum/go-ethereum/common"
)

type Input struct {
	Recipient common.Address
	Amount    *big.Int
}

type Entry struct {
	Amount  *big.Int
	Nonce   *big.Int
	Claimed bool
}

type Store struct {
	mu    sync.RWMutex
	pools map[common.Address]map[common.Address]*Entry
}

func New() *Store {
	return &Store{pools: make(map[common.Address]map[common.Address]*Entry)}
}

// Submit validates and stores a pool's allocations. Allocations are immutable:
// a pool that already has a table is rejected. sum(amounts) must be <= total.
func (s *Store) Submit(pool common.Address, entries []Input, total *big.Int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.pools[pool]; exists {
		return fmt.Errorf("allocations already set for pool")
	}

	table := make(map[common.Address]*Entry, len(entries))
	sum := new(big.Int)
	for i, in := range entries {
		if in.Amount == nil || in.Amount.Sign() <= 0 {
			return fmt.Errorf("amount must be positive")
		}
		if _, dup := table[in.Recipient]; dup {
			return fmt.Errorf("duplicate recipient")
		}
		table[in.Recipient] = &Entry{Amount: new(big.Int).Set(in.Amount), Nonce: big.NewInt(int64(i))}
		sum.Add(sum, in.Amount)
	}
	if sum.Cmp(total) > 0 {
		return fmt.Errorf("allocation total exceeds deposit")
	}

	s.pools[pool] = table
	return nil
}

// Totals returns the aggregate allocated amount and recipient count for a pool.
func (s *Store) Totals(pool common.Address) (totalAllocated *big.Int, count int, ok bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	table, exists := s.pools[pool]
	if !exists {
		return nil, 0, false
	}
	sum := new(big.Int)
	for _, e := range table {
		sum.Add(sum, e.Amount)
	}
	return sum, len(table), true
}

// RecipientEntry is one row of a pool's table, with the recipient key attached.
type RecipientEntry struct {
	Recipient common.Address
	Amount    *big.Int
	Nonce     *big.Int
}

// Entries returns every allocation row for a pool. Amount/Nonce are copies so
// callers cannot mutate the store. ok=false for an unknown pool.
func (s *Store) Entries(pool common.Address) ([]RecipientEntry, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	table, exists := s.pools[pool]
	if !exists {
		return nil, false
	}
	rows := make([]RecipientEntry, 0, len(table))
	for rcpt, e := range table {
		rows = append(rows, RecipientEntry{
			Recipient: rcpt,
			Amount:    new(big.Int).Set(e.Amount),
			Nonce:     new(big.Int).Set(e.Nonce),
		})
	}
	return rows, true
}

func (s *Store) Lookup(pool, recipient common.Address) (Entry, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	table, ok := s.pools[pool]
	if !ok {
		return Entry{}, false
	}
	e, ok := table[recipient]
	if !ok {
		return Entry{}, false
	}
	return *e, true
}
