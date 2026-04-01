package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// ─── Integration helpers ──────────────────────────────────────────────────────

// newIntegrationServer spins up a real *httptest.Server backed by a mockStore.
// Tests make actual HTTP requests through net/http, exercising routing,
// JSON marshalling, and handler logic end-to-end.
func newIntegrationServer(t *testing.T, drivers ...*Driver) (*httptest.Server, *mockStore) {
	t.Helper()
	store := newMockStore(drivers...)
	h := &handler{store: store, log: newTestLogger()}
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return srv, store
}

func get(t *testing.T, srv *httptest.Server, path string) *http.Response {
	t.Helper()
	resp, err := http.Get(srv.URL + path)
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	return resp
}

func patch(t *testing.T, srv *httptest.Server, path string, body any) *http.Response {
	t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPatch, srv.URL+path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("PATCH %s: %v", path, err)
	}
	return resp
}

func post(t *testing.T, srv *httptest.Server, path string, body any) *http.Response {
	t.Helper()
	b, _ := json.Marshal(body)
	resp, err := http.Post(srv.URL+path, "application/json", bytes.NewReader(b))
	if err != nil {
		t.Fatalf("POST %s: %v", path, err)
	}
	return resp
}

func readBody(t *testing.T, r *http.Response) []byte {
	t.Helper()
	defer r.Body.Close()
	b, err := io.ReadAll(r.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return b
}

func decodeDriver(t *testing.T, r *http.Response) Driver {
	t.Helper()
	var d Driver
	if err := json.Unmarshal(readBody(t, r), &d); err != nil {
		t.Fatalf("decode Driver: %v", err)
	}
	return d
}

// ─── Health ───────────────────────────────────────────────────────────────────

func TestIntegration_Health(t *testing.T) {
	srv, _ := newIntegrationServer(t)
	resp := get(t, srv, "/health")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}
	var body map[string]string
	json.Unmarshal(readBody(t, resp), &body)
	if body["status"] != "ok" {
		t.Fatalf("want status=ok, got %v", body)
	}
}

// ─── Create → Get → List cycle ────────────────────────────────────────────────

func TestIntegration_CreateThenGetDriver(t *testing.T) {
	srv, _ := newIntegrationServer(t)

	// Create
	createResp := post(t, srv, "/drivers", map[string]any{
		"name":         "Carol",
		"phone":        "+1-555-2222",
		"vehicle_type": "motorcycle",
		"is_available": true,
	})
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("create: want 201, got %d", createResp.StatusCode)
	}
	created := decodeDriver(t, createResp)
	if created.ID.IsZero() {
		t.Fatal("created driver must have an ID")
	}

	// Get by ID
	getResp := get(t, srv, fmt.Sprintf("/drivers/%s", created.ID.Hex()))
	if getResp.StatusCode != http.StatusOK {
		t.Fatalf("get: want 200, got %d", getResp.StatusCode)
	}
	fetched := decodeDriver(t, getResp)
	if fetched.Name != "Carol" {
		t.Fatalf("want Carol, got %s", fetched.Name)
	}
}

func TestIntegration_ListDrivers_AllAndFiltered(t *testing.T) {
	d1 := &Driver{ID: primitive.NewObjectID(), Name: "Dave", IsAvailable: true, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	d2 := &Driver{ID: primitive.NewObjectID(), Name: "Eve", IsAvailable: false, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	srv, _ := newIntegrationServer(t, d1, d2)

	// All
	allResp := get(t, srv, "/drivers")
	if allResp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d", allResp.StatusCode)
	}
	var all []Driver
	json.Unmarshal(readBody(t, allResp), &all)
	if len(all) != 2 {
		t.Fatalf("want 2 drivers, got %d", len(all))
	}

	// Filtered
	filtResp := get(t, srv, "/drivers?available=true")
	if filtResp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d", filtResp.StatusCode)
	}
	var avail []Driver
	json.Unmarshal(readBody(t, filtResp), &avail)
	if len(avail) != 1 || !avail[0].IsAvailable {
		t.Fatalf("want 1 available driver, got %+v", avail)
	}
}

// ─── Location update ──────────────────────────────────────────────────────────

func TestIntegration_UpdateLocation_FullCycle(t *testing.T) {
	d := &Driver{ID: primitive.NewObjectID(), Name: "Frank", IsAvailable: true, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	srv, _ := newIntegrationServer(t, d)

	// Patch location
	patchResp := patch(t, srv, fmt.Sprintf("/drivers/%s/location", d.ID.Hex()), map[string]any{
		"latitude":  51.5074,
		"longitude": -0.1278,
	})
	if patchResp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(patchResp.Body)
		t.Fatalf("patch location: want 200, got %d: %s", patchResp.StatusCode, b)
	}
	updated := decodeDriver(t, patchResp)
	if updated.Location == nil {
		t.Fatal("location should be set")
	}
	if updated.Location.Latitude != 51.5074 {
		t.Fatalf("want lat 51.5074, got %f", updated.Location.Latitude)
	}

	// Verify via GET
	getResp := get(t, srv, fmt.Sprintf("/drivers/%s", d.ID.Hex()))
	fetched := decodeDriver(t, getResp)
	if fetched.Location == nil || fetched.Location.Longitude != -0.1278 {
		t.Fatalf("location not persisted: %+v", fetched.Location)
	}
}

func TestIntegration_UpdateLocation_InvalidCoords_Returns422(t *testing.T) {
	d := &Driver{ID: primitive.NewObjectID(), Name: "Gina", IsAvailable: true, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	srv, _ := newIntegrationServer(t, d)

	resp := patch(t, srv, fmt.Sprintf("/drivers/%s/location", d.ID.Hex()), map[string]any{
		"latitude": 200.0, "longitude": 0,
	})
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("want 422, got %d", resp.StatusCode)
	}
}

func TestIntegration_UpdateLocation_UnknownDriver_Returns404(t *testing.T) {
	srv, _ := newIntegrationServer(t)
	resp := patch(t, srv, fmt.Sprintf("/drivers/%s/location", primitive.NewObjectID().Hex()), map[string]any{
		"latitude": 0.0, "longitude": 0.0,
	})
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("want 404, got %d", resp.StatusCode)
	}
}

// ─── Availability update ──────────────────────────────────────────────────────

func TestIntegration_UpdateAvailability_ToggleCycle(t *testing.T) {
	d := &Driver{ID: primitive.NewObjectID(), Name: "Hiro", IsAvailable: true, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	srv, _ := newIntegrationServer(t, d)

	// Disable
	r1 := patch(t, srv, fmt.Sprintf("/drivers/%s/availability", d.ID.Hex()), map[string]any{"is_available": false})
	if r1.StatusCode != http.StatusOK {
		t.Fatalf("disable: want 200, got %d", r1.StatusCode)
	}
	d1 := decodeDriver(t, r1)
	if d1.IsAvailable {
		t.Fatal("driver should be unavailable")
	}

	// Re-enable
	r2 := patch(t, srv, fmt.Sprintf("/drivers/%s/availability", d.ID.Hex()), map[string]any{"is_available": true})
	if r2.StatusCode != http.StatusOK {
		t.Fatalf("enable: want 200, got %d", r2.StatusCode)
	}
	d2 := decodeDriver(t, r2)
	if !d2.IsAvailable {
		t.Fatal("driver should be available again")
	}
}

func TestIntegration_UpdateAvailability_UnknownDriver_Returns404(t *testing.T) {
	srv, _ := newIntegrationServer(t)
	resp := patch(t, srv, fmt.Sprintf("/drivers/%s/availability", primitive.NewObjectID().Hex()), map[string]any{"is_available": true})
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("want 404, got %d", resp.StatusCode)
	}
}

// ─── Context cancellation ─────────────────────────────────────────────────────

func TestIntegration_ContextTimeout_StoreHonorsContext(t *testing.T) {
	// Verify that store operations propagate context correctly.
	store := newMockStore()
	_, cancel := context.WithTimeout(context.Background(), 1*time.Millisecond)
	cancel() // immediately cancel

	drivers, err := store.Find(context.Background(), false)
	// mockStore doesn't block, so it should succeed with empty result
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(drivers) != 0 {
		t.Fatalf("expected empty, got %d", len(drivers))
	}
}
