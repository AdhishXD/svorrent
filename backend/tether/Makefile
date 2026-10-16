CXX ?= clang++
CXXFLAGS ?= -O2 -std=c++17 -Wall -Wextra -Iinclude
LDFLAGS ?= -L../bin -ltetherkit -Wl,-rpath,@executable_path -Wl,-rpath,/Library/PrivilegedHelperTools

TARGET = ../bin/svorrent-tetherd
SRC = svorrent-tetherd.cc

.PHONY: all clean test-list

all: $(TARGET)

$(TARGET): $(SRC)
	@mkdir -p ../bin
	$(CXX) $(CXXFLAGS) $(SRC) $(LDFLAGS) -o $(TARGET)
	@codesign --force --sign - $(TARGET) 2>/dev/null || true
	@echo "Built $(TARGET) successfully."

test-list: $(TARGET)
	$(TARGET) --list

clean:
	rm -f $(TARGET)
