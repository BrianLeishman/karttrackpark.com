package main

import (
	"log"
	"os"
	"path/filepath"

	"github.com/evanw/esbuild/pkg/api"
)

func main() {
	siteDir := siteDirectory()

	result := api.Build(opts(siteDir))
	if len(result.Errors) > 0 {
		os.Exit(1)
	}
}

func opts(siteDir string) api.BuildOptions {
	return api.BuildOptions{
		EntryPoints:       []string{filepath.Join(siteDir, "ts/index.ts")},
		Outfile:           filepath.Join(siteDir, "assets/js/app.js"),
		Sourcemap:         api.SourceMapLinked,
		Bundle:            true,
		Format:            api.FormatESModule,
		Target:            api.ES2020,
		Write:             true,
		MinifyWhitespace:  true,
		MinifyIdentifiers: true,
		MinifySyntax:      true,
		Color:             api.ColorAlways,
		LogLevel:          api.LogLevelInfo,
	}
}

func siteDirectory() string {
	dir, err := findRepoRoot()
	if err != nil {
		log.Fatal(err)
	}
	return filepath.Join(dir, "site")
}

func findRepoRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", os.ErrNotExist
		}
		dir = parent
	}
}
