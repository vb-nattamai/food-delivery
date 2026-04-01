package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// ─── Mock store ───────────────────────────────────────────────────────────────

type mockStore struct {
	drivers map[string]*Driver
	// injectable errors for failure-path tests
	findErr   error
	insertErr error
	updateErr error
}

func newMockStore(drivers ...*Driver) *mockStore {
	m := &mockStore{drivers: make(map[string]*Driver)}
	for _, d := range drivers {
		m.drivers[d.ID.Hex()] = d
	}
	return m
}

func (m *mockStore) Find(_ context.Context, onlyAvailable bool) ([]Driver, error) {
	if m.findErr != nil {
		return nil, m.findErr
	}
	var out []Driver
	for _, d := range m.drivers {
		if !onlyAvailable || d.IsAvailable {
			out = append(out, *d)
		}
	}
	return out, nil
}

func (m *mockStore) FindOne(_ context.Context, id primitive.ObjectID) (*Driver, error) {
	if m.findErr != nil {
		return nil, m.findErr
	}
	d, ok := m.drivers[id.Hex()]
	if !ok {
		return nil, nil
	}
	return d, nil
}

func (m *mockStore) InsertOne(_ context.Context, d Driver) (*Driver, error) {
	if m.insertErr != nil {
		return nil, m.insertErr
	}
	d.ID = primitive.NewObjectID()
	d.CreatedAt = time.Now().UTC()
	d.UpdatedAt = time.Now().UTC()
	m.drivers[d.ID.Hex()] = &d
	return &d, nil
}

func (m *mockStore) UpdateLocation(_ context.Context, id primitive.ObjectID, loc GeoPoint) (*Driver, error) {
	if m.updateErr != nil {
		return nil, m.updateErr
	}
	d, ok := m.drivers[id.Hex()]
	if !ok {
		return nil, nil
	}
	d.Location = &loc
	d.UpdatedAt = time.Now().UTC()
	return d, nil
}

func (m *mockStore) UpdateAvailability(_ context.Context, id primitive.ObjectID, available bool) (*Driver, error) {
	if m.updateErr != nil {
		return nil, m.updateErr
	}
	d, ok := m.drivers[id.Hex()]
	if !ok {
		return nil, nil
	}
	d.IsAvailable = available
	d.UpdatedAt = time.Now().UTC()
	return d, nil
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func newHandler(store DriverStore) *handler {
	return &handler{store: store, log: newTestLogger()}
}

func newTestLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func do(h *handler, method, path string, body any) *httptest.ResponseRecorder {
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, path, &buf)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

func decode[T any](t *testing.T, w *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.NewDecoder(w.Body).Decode(&v); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return v
}

func makeDriver() *Driver {
	return &Driver{
		ID:          primitive.NewObjectID(),
		Name:        "Alice",
		Phone:       "+1-555-1234",
		VehicleType: "bicycle",
		IsAvailable: true,
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}
}

// ─── Health ───────────────────────────────────────────────────────────────────

func TestHealth(t *testing.T) {
	w := do(newHandler(newMockStore()), http.MethodGet, "/health", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
	var resp map[string]string
	_ = json.NewDecoder(w.Body).Decode(&resp)
	if resp["status"] != "ok" {
		t.Fatalf("want status=ok, got %v", resp)
	}
}

// ─── List drivers ─────────────────────────────────────────────────────────────

func TestListDrivers_Empty(t *testing.T) {
	w := do(newHandler(newMockStore()), http.MethodGet, "/drivers", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
}

func TestListDrivers_ReturnsAll(t *testing.T) {
	d1, d2 := makeDriver(), makeDriver()
	d2.IsAvailable = false
	store := newMockStore(d1, d2)

	w := do(newHandler(store), http.MethodGet, "/drivers", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
	var drivers []Driver
	_ = json.NewDecoder(w.Body).Decode(&drivers)
	if len(drivers) != 2 {
		t.Fatalf("want 2 drivers, got %d", len(drivers))
	}
}

func TestListDrivers_FilterAvailable(t *testing.T) {
	d1, d2 := makeDriver(), makeDriver()
	d2.IsAvailable = false
	store := newMockStore(d1, d2)

	w := do(newHandler(store), http.MethodGet, "/drivers?available=true", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
	var drivers []Driver
	_ = json.NewDecoder(w.Body).Decode(&drivers)
	if len(drivers) != 1 {
		t.Fatalf("want 1 available driver, got %d", len(drivers))
	}
	if !drivers[0].IsAvailable {
		t.Fatal("returned driver should be available")
	}
}

// ─── Create driver ────────────────────────────────────────────────────────────

func TestCreateDriver(t *testing.T) {
	w := do(newHandler(newMockStore()), http.MethodPost, "/drivers", map[string]any{
		"name":         "Bob",
		"phone":        "+1-555-9999",
		"vehicle_type": "car",
		"is_available": true,
	})
	if w.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", w.Code, w.Body)
	}
	d := decode[Driver](t, w)
	if d.Name != "Bob" {
		t.Fatalf("want name=Bob, got %s", d.Name)
	}
	if d.ID.IsZero() {
		t.Fatal("created driver must have a non-zero ObjectID")
	}
}

func TestCreateDriver_InvalidJSON(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/drivers", bytes.NewBufferString("not-json"))
	w := httptest.NewRecorder()
	newHandler(newMockStore()).ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", w.Code)
	}
}

// ─── Get driver by ID ─────────────────────────────────────────────────────────

func TestGetDriver_Found(t *testing.T) {
	d := makeDriver()
	w := do(newHandler(newMockStore(d)), http.MethodGet, "/drivers/"+d.ID.Hex(), nil)
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", w.Code, w.Body)
	}
	got := decode[Driver](t, w)
	if got.Name != d.Name {
		t.Fatalf("want name=%s, got %s", d.Name, got.Name)
	}
}

func TestGetDriver_NotFound(t *testing.T) {
	w := do(newHandler(newMockStore()), http.MethodGet, "/drivers/"+primitive.NewObjectID().Hex(), nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", w.Code)
	}
}

func TestGetDriver_InvalidID(t *testing.T) {
	w := do(newHandler(newMockStore()), http.MethodGet, "/drivers/not-an-object-id", nil)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", w.Code)
	}
}

// ─── Update location ──────────────────────────────────────────────────────────

func TestUpdateLocation_Success(t *testing.T) {
	d := makeDriver()
	w := do(newHandler(newMockStore(d)), http.MethodPatch, "/drivers/"+d.ID.Hex()+"/location", map[string]any{
		"latitude":  37.7749,
		"longitude": -122.4194,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", w.Code, w.Body)
	}
	got := decode[Driver](t, w)
	if got.Location == nil {
		t.Fatal("location should be set after update")
	}
	if got.Location.Latitude != 37.7749 {
		t.Fatalf("want lat=37.7749, got %f", got.Location.Latitude)
	}
}

func TestUpdateLocation_NotFound(t *testing.T) {
	w := do(newHandler(newMockStore()), http.MethodPatch, "/drivers/"+primitive.NewObjectID().Hex()+"/location", map[string]any{
		"latitude": 0, "longitude": 0,
	})
	if w.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", w.Code)
	}
}

func TestUpdateLocation_InvalidCoordinates(t *testing.T) {
	d := makeDriver()
	w := do(newHandler(newMockStore(d)), http.MethodPatch, "/drivers/"+d.ID.Hex()+"/location", map[string]any{
		"latitude":  999.0,  // out of range
		"longitude": -122.4,
	})
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("want 422, got %d", w.Code)
	}
}

func TestUpdateLocation_InvalidJSON(t *testing.T) {
	d := makeDriver()
	req := httptest.NewRequest(http.MethodPatch, "/drivers/"+d.ID.Hex()+"/location", bytes.NewBufferString("{bad"))
	w := httptest.NewRecorder()
	newHandler(newMockStore(d)).ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", w.Code)
	}
}

// ─── Update availability ──────────────────────────────────────────────────────

func TestUpdateAvailability_SetFalse(t *testing.T) {
	d := makeDriver() // starts as available
	w := do(newHandler(newMockStore(d)), http.MethodPatch, "/drivers/"+d.ID.Hex()+"/availability", map[string]any{
		"is_available": false,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", w.Code, w.Body)
	}
	got := decode[Driver](t, w)
	if got.IsAvailable {
		t.Fatal("driver should now be unavailable")
	}
}

func TestUpdateAvailability_SetTrue(t *testing.T) {
	d := makeDriver()
	d.IsAvailable = false
	w := do(newHandler(newMockStore(d)), http.MethodPatch, "/drivers/"+d.ID.Hex()+"/availability", map[string]any{
		"is_available": true,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", w.Code, w.Body)
	}
	got := decode[Driver](t, w)
	if !got.IsAvailable {
		t.Fatal("driver should now be available")
	}
}

func TestUpdateAvailability_NotFound(t *testing.T) {
	w := do(newHandler(newMockStore()), http.MethodPatch, "/drivers/"+primitive.NewObjectID().Hex()+"/availability", map[string]any{
		"is_available": true,
	})
	if w.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", w.Code)
	}
}

// ─── Routing ──────────────────────────────────────────────────────────────────

func TestUnknownRoute_Returns404(t *testing.T) {
	w := do(newHandler(newMockStore()), http.MethodGet, "/unknown", nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", w.Code)
	}
}

func TestWrongMethod_Returns404(t *testing.T) {
	w := do(newHandler(newMockStore()), http.MethodDelete, "/drivers", nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", w.Code)
	}
}

// ─── Helper functions ─────────────────────────────────────────────────────────

func TestGetenv_ReturnsFallback(t *testing.T) {
	got := getenv("__NONEXISTENT_VAR_XYZ__", "default")
	if got != "default" {
		t.Fatalf("want default, got %s", got)
	}
}

func TestGetenv_ReturnsEnvValue(t *testing.T) {
	t.Setenv("__TEST_VAR__", "hello")
	got := getenv("__TEST_VAR__", "fallback")
	if got != "hello" {
		t.Fatalf("want hello, got %s", got)
	}
}

func TestExtractDriverID_Valid(t *testing.T) {
	id := primitive.NewObjectID()
	got, err := extractDriverID("/drivers/" + id.Hex())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != id {
		t.Fatalf("want %s, got %s", id.Hex(), got.Hex())
	}
}

func TestExtractDriverID_Invalid(t *testing.T) {
	_, err := extractDriverID("/drivers/not-hex")
	if err == nil {
		t.Fatal("expected error for invalid hex ID")
	}
}

func TestIsDriverByID(t *testing.T) {
	cases := []struct {
		path string
		want bool
	}{
		{"/drivers/" + primitive.NewObjectID().Hex(), true},
		{"/drivers", false},
		{"/drivers/", false},
		{"/drivers/abc123/location", false},
		{"/health", false},
	}
	for _, c := range cases {
		got := isDriverByID(c.path)
		if got != c.want {
			t.Errorf("isDriverByID(%q) = %v, want %v", c.path, got, c.want)
		}
	}
}
