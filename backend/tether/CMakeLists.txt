cmake_minimum_required(VERSION 3.16)
project(svorrent_tetherd LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include_directories(include)
link_directories(${CMAKE_CURRENT_SOURCE_DIR}/../bin)

add_executable(svorrent-tetherd svorrent-tetherd.cc)

target_link_libraries(svorrent-tetherd PRIVATE tetherkit)

set_target_properties(svorrent-tetherd PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/../bin
    BUILD_RPATH "@executable_path;/Library/PrivilegedHelperTools"
    INSTALL_RPATH "@executable_path;/Library/PrivilegedHelperTools"
)
