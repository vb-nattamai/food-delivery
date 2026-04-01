// Package main is the entry point for the Driver Service.
// It exposes an HTTP API for driver profiles and location tracking,
// backed by MongoDB, with graceful shutdown on SIGINT/SIGTERM.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// ─── Domain ───────────────────────────────────────────────────────────────────

// Driver represents a delivery driver stored in MongoDB.
type Driver struct {
	ID          primitive.ObjectID `bson:"_id,omitempty"    json:"id"`
	Name        string             `bson:"name"             json:"name"`
	Phone       string             `bson:"phone"            json:"phone"`
	VehicleType string             `bson:"vehicle_type"     json:"vehicleType"`
	IsAvailable bool               `bson:"is_available"     json:"isAvailable"`
	Location    *GeoPoint          `bson:"location"         json:"location,omitempty"`
	CreatedAt   time.Time          `bson:"created_at"       json:"createdAt"`
	UpdatedAt   time.Time          `bson:"updated_at"       json:"updatedAt"`
}

// GeoPoint stores a driver's current GPS coordinates.
type GeoPoint struct {
	Latitude  float64 `bson:"lat" json:"latitude"`
	Longitude float64 `bson:"lng" json:"longitude"`
}

// ─── DriverStore interface ────────────────────────────────────────────────────

// DriverStore abstracts all MongoDB operations so handlers can be tested
// without a real database connection.
type DriverStore interface {
	Find(ctx context.Context, onlyAvailable bool) ([]Driver, error)
	FindOne(ctx context.Context, id primitive.ObjectID) (*Driver, error)
	InsertOne(ctx context.Context, d Driver) (*Driver, error)
	UpdateLocation(ctx context.Context, id primitive.ObjectID, loc GeoPoint) (*Driver, error)
	UpdateAvailability(ctx context.Context, id primitive.ObjectID, available bool) (*Driver, error)
}

// ─── mongoDriverStore ─────────────────────────────────────────────────────────

type mongoDriverStore struct {
	coll *mongo.Collection
}

func (s *mongoDriverStore) Find(ctx context.Context, onlyAvailable bool) ([]Driver, error) {
	filter := bson.M{}
	if onlyAvailable {
		filter["is_available"] = true
	}
	cur, err := s.coll.Find(ctx, filter)
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)
	var drivers []Driver
	if err = cur.All(ctx, &drivers); err != nil {
		return nil, err
	}
	return drivers, nil
}

func (s *mongoDriverStore) FindOne(ctx context.Context, id primitive.ObjectID) (*Driver, error) {
	var d Driver
	err := s.coll.FindOne(ctx, bson.M{"_id": id}).Decode(&d)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	return &d, err
}

func (s *mongoDriverStore) InsertOne(ctx context.Context, d Driver) (*Driver, error) {
	d.ID = primitive.NewObjectID()
	d.CreatedAt = time.Now().UTC()
	d.UpdatedAt = time.Now().UTC()
	if _, err := s.coll.InsertOne(ctx, d); err != nil {
		return nil, err
	}
	return &d, nil
}

func (s *mongoDriverStore) UpdateLocation(ctx context.Context, id primitive.ObjectID, loc GeoPoint) (*Driver, error) {
	now := time.Now().UTC()
	after := options.After
	result := s.coll.FindOneAndUpdate(
		ctx,
		bson.M{"_id": id},
		bson.M{"$set": bson.M{"location": loc, "updated_at": now}},
		&options.FindOneAndUpdateOptions{ReturnDocument: &after},
	)
	if result.Err() != nil {
		if errors.Is(result.Err(), mongo.ErrNoDocuments) {
			return nil, nil
		}
		return nil, result.Err()
	}
	var d Driver
	if err := result.Decode(&d); err != nil {
		return nil, err
	}
	return &d, nil
}

func (s *mongoDriverStore) UpdateAvailability(ctx context.Context, id primitive.ObjectID, available bool) (*Driver, error) {
	now := time.Now().UTC()
	after := options.After
	result := s.coll.FindOneAndUpdate(
		ctx,
		bson.M{"_id": id},
		bson.M{"$set": bson.M{"is_available": available, "updated_at": now}},
		&options.FindOneAndUpdateOptions{ReturnDocument: &after},
	)
	if result.Err() != nil {
		if errors.Is(result.Err(), mongo.ErrNoDocuments) {
			return nil, nil
		}
		return nil, result.Err()
	}
	var d Driver
	if err := result.Decode(&d); err != nil {
		return nil, err
	}
	return &d, nil
}

// ─── Handler ──────────────────────────────────────────────────────────────────

type handler struct {
	store DriverStore
	log   *slog.Logger
}

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	switch {
	case r.Method == http.MethodGet && path == "/health":
		h.health(w, r)
	case r.Method == http.MethodGet && path == "/drivers":
		h.listDrivers(w, r)
	case r.Method == http.MethodPost && path == "/drivers":
		h.createDriver(w, r)
	case r.Method == http.MethodGet && isDriverByID(path):
		h.getDriver(w, r)
	case r.Method == http.MethodPatch && strings.HasSuffix(path, "/location"):
		h.updateLocation(w, r)
	case r.Method == http.MethodPatch && strings.HasSuffix(path, "/availability"):
		h.updateAvailability(w, r)
	default:
		http.NotFound(w, r)
	}
}

// isDriverByID returns true for paths of the form /drivers/{id} (exactly 2 segments).
func isDriverByID(path string) bool {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	return len(parts) == 2 && parts[0] == "drivers" && parts[1] != ""
}

// extractDriverID parses the ObjectID from the second path segment (/drivers/{id}/...).
func extractDriverID(path string) (primitive.ObjectID, error) {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) < 2 || parts[1] == "" {
		return primitive.ObjectID{}, errors.New("missing driver id")
	}
	return primitive.ObjectIDFromHex(parts[1])
}

func (h *handler) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *handler) listDrivers(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	onlyAvailable := r.URL.Query().Get("available") == "true"
	drivers, err := h.store.Find(ctx, onlyAvailable)
	if err != nil {
		h.log.Error("listDrivers", "err", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, drivers)
}

func (h *handler) createDriver(w http.ResponseWriter, r *http.Request) {
	var d Driver
	if err := json.NewDecoder(r.Body).Decode(&d); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	created, err := h.store.InsertOne(ctx, d)
	if err != nil {
		h.log.Error("createDriver", "err", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (h *handler) getDriver(w http.ResponseWriter, r *http.Request) {
	id, err := extractDriverID(r.URL.Path)
	if err != nil {
		http.Error(w, "invalid driver id", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	d, err := h.store.FindOne(ctx, id)
	if err != nil {
		h.log.Error("getDriver", "err", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if d == nil {
		http.Error(w, "driver not found", http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, d)
}

func (h *handler) updateLocation(w http.ResponseWriter, r *http.Request) {
	id, err := extractDriverID(r.URL.Path)
	if err != nil {
		http.Error(w, "invalid driver id", http.StatusBadRequest)
		return
	}

	var loc GeoPoint
	if err := json.NewDecoder(r.Body).Decode(&loc); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	if loc.Latitude < -90 || loc.Latitude > 90 || loc.Longitude < -180 || loc.Longitude > 180 {
		http.Error(w, "latitude must be -90..90, longitude -180..180", http.StatusUnprocessableEntity)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	d, err := h.store.UpdateLocation(ctx, id, loc)
	if err != nil {
		h.log.Error("updateLocation", "err", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if d == nil {
		http.Error(w, "driver not found", http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, d)
}

func (h *handler) updateAvailability(w http.ResponseWriter, r *http.Request) {
	id, err := extractDriverID(r.URL.Path)
	if err != nil {
		http.Error(w, "invalid driver id", http.StatusBadRequest)
		return
	}

	var req struct {
		IsAvailable bool `json:"is_available"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	d, err := h.store.UpdateAvailability(ctx, id, req.IsAvailable)
	if err != nil {
		h.log.Error("updateAvailability", "err", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if d == nil {
		http.Error(w, "driver not found", http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, d)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	mongoURI := getenv("MONGO_URI", "mongodb://localhost:27017")
	mongoDB := getenv("MONGO_DB", "driverservice")
	addr := getenv("ADDR", ":8083")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	client, err := mongo.Connect(ctx, options.Client().ApplyURI(mongoURI))
	if err != nil {
		log.Error("mongo connect", "err", err)
		os.Exit(1)
	}
	if err = client.Ping(ctx, nil); err != nil {
		log.Error("mongo ping", "err", err)
		os.Exit(1)
	}
	log.Info("connected to MongoDB", "uri", mongoURI, "db", mongoDB)

	collection := client.Database(mongoDB).Collection("drivers")
	indexModel := mongo.IndexModel{Keys: bson.D{{Key: "location", Value: "2dsphere"}}}
	if _, err = collection.Indexes().CreateOne(context.Background(), indexModel); err != nil {
		log.Warn("could not create 2dsphere index (may already exist)", "err", err)
	}

	h := &handler{store: &mongoDriverStore{coll: collection}, log: log}
	srv := &http.Server{
		Addr:         addr,
		Handler:      h,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Info("driver service listening", "addr", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Error("listen error", "err", err)
			os.Exit(1)
		}
	}()

	<-quit
	log.Info("shutting down gracefully…")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Error("server shutdown error", "err", err)
	}
	if err := client.Disconnect(shutdownCtx); err != nil {
		log.Error("mongo disconnect error", "err", err)
	}
	log.Info("driver service stopped")
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
